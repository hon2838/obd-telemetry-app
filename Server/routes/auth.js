// Authentication and Device Pairing/Management routes plugin
const crypto = require('crypto');
const fs = require('fs');

async function authRoutes(fastify, options) {
  const {
    OBD_API_KEY,
    usersStore,
    vehiclesStore,
    devicesStore,
    sessionsStore,
    pendingPairingsByCode,
    pendingPairingsByToken,
    cleanExpiredPairings,
    constantTimeEquals,
    newSession,
    setSessionCookie,
    clearSessionCookie,
    parseCookies,
    SESSION_COOKIE,
    verifyPassword,
    hashPasswordAsync,
    authenticateRequest,
    canAccessVehicle,
    isAdmin,
    vehicleScope,
    vehicleExists,
    serializeMutation,
    runFileTransactionSync,
    persist,
    replaceArrayContents,
    retryablePersistenceError,
    invalidateAnalyticsCaches,
    getIsPoisoned,
    DEFAULT_VEHICLE_ID,
    USERS_PATH,
    VEHICLES_PATH,
    DEVICES_PATH,
    INITIAL_ADMIN_SECRET_PATH
  } = options;

  // ----- User Authentication & Account Management -------------------------

  fastify.post('/api/auth/login', {
    config: {
      rateLimit: {
        max: 15,
        timeWindow: '1 minute'
      }
    }
  }, async (request, reply) => {
    const { username, password } = request.body || {};
    if (!username || typeof username !== 'string' || !password || typeof password !== 'string') {
      return reply.status(400).send({ error: 'Username and password are required' });
    }

    // Master key login support
    if (constantTimeEquals(password, OBD_API_KEY)) {
      const { token: sessionToken, session } = newSession({ userId: 'usr-admin', username: 'admin', type: 'master' });
      setSessionCookie(reply, sessionToken);
      return reply.send({
        token: sessionToken,
        csrfToken: session.csrfToken,
        user: {
          id: 'usr-admin',
          username: 'admin',
          role: 'admin',
          mustChangePassword: false,
          vehicles: vehiclesStore.map(v => v.id)
        }
      });
    }

    const user = usersStore.find(u => u.username.toLowerCase() === username.toLowerCase().trim());
    if (!user || !(await verifyPassword(password, user.passwordSalt, user.passwordHash))) {
      return reply.status(401).send({ error: 'Invalid username or password' });
    }

    const { token: sessionToken, session } = newSession({ userId: user.id, username: user.username });
    setSessionCookie(reply, sessionToken);

    const userRole = user.role || ((user.username === 'admin' || user.id === 'usr-admin') ? 'admin' : 'user');
    const userVehicles = isAdmin({ type: 'user', user: { ...user, role: userRole } })
      ? vehiclesStore.map(v => v.id)
      : (user.vehicles || [DEFAULT_VEHICLE_ID]);

    return reply.send({
      token: sessionToken,
      csrfToken: session.csrfToken,
      user: {
        id: user.id,
        username: user.username,
        role: userRole,
        mustChangePassword: !!user.mustChangePassword,
        vehicles: userVehicles
      }
    });
  });

  fastify.post('/api/auth/change-password', async (request, reply) => {
    const auth = request.auth || (await authenticateRequest(request));
    const { currentPassword, newPassword, username } = request.body || {};
    if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 8) {
      return reply.status(400).send({ error: 'New password must be at least 8 characters long' });
    }

    let targetUser = null;
    if (auth && auth.type === 'user') {
      targetUser = auth.user;
      if (!targetUser.mustChangePassword) {
        if (!currentPassword || !(await verifyPassword(currentPassword, targetUser.passwordSalt, targetUser.passwordHash))) {
          return reply.status(400).send({ error: 'Current password is incorrect' });
        }
      }
    } else if (auth && auth.type === 'master') {
      const searchName = (username || 'admin').toLowerCase().trim();
      targetUser = usersStore.find(u => u.username.toLowerCase() === searchName);
      if (!targetUser) {
        return reply.status(404).send({ error: 'User not found' });
      }
    } else {
      const searchName = (username || 'admin').toLowerCase().trim();
      targetUser = usersStore.find(u => u.username.toLowerCase() === searchName);
      if (!targetUser) {
        return reply.status(404).send({ error: 'User not found' });
      }
      if (!currentPassword || !(await verifyPassword(currentPassword, targetUser.passwordSalt, targetUser.passwordHash))) {
        return reply.status(400).send({ error: 'Current password is incorrect' });
      }
    }

    const { salt, hash } = await hashPasswordAsync(newPassword);
    const updatedUser = {
      ...targetUser,
      passwordSalt: salt,
      passwordHash: hash,
      mustChangePassword: false,
      updatedAt: Date.now()
    };
    // Serialized so two concurrent rotations cannot interleave read-modify-write.
    return serializeMutation(async () => {
      if (!usersStore.some(user => user.id === targetUser.id)) {
        return reply.status(404).send({ error: 'User not found' });
      }
      const liveCandidates = usersStore.map(user => user.id === targetUser.id ? updatedUser : user);
      try {
        await persist(USERS_PATH, liveCandidates);
      } catch (err) {
        return retryablePersistenceError(reply, request, err);
      }
      replaceArrayContents(usersStore, liveCandidates);

      if (targetUser.id === 'usr-admin' && fs.existsSync(INITIAL_ADMIN_SECRET_PATH)) {
        try {
          fs.unlinkSync(INITIAL_ADMIN_SECRET_PATH);
        } catch (err) {
          request.log.warn(`Password changed, but the temporary admin secret could not be removed: ${err}`);
        }
      }

      // Invalidate all older sessions for this user
      for (const [token, sess] of sessionsStore.entries()) {
        if (sess.userId === targetUser.id) {
          sessionsStore.delete(token);
        }
      }

      const { token: sessionToken, session } = newSession({
        userId: targetUser.id,
        username: targetUser.username
      });
      setSessionCookie(reply, sessionToken);

      return reply.send({
        success: true,
        message: 'Password updated successfully',
        token: sessionToken,
        csrfToken: session.csrfToken,
        user: {
          id: targetUser.id,
          username: targetUser.username,
          role: targetUser.role || (targetUser.username === 'admin' ? 'admin' : 'user'),
          mustChangePassword: false,
          vehicles: targetUser.vehicles || [DEFAULT_VEHICLE_ID]
        }
      });
    });
  });

  fastify.post('/api/auth/logout', async (request, reply) => {
    const authHeader = request.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
      sessionsStore.delete(authHeader.slice(7).trim());
    }
    const cookies = parseCookies(request.headers.cookie);
    if (cookies[SESSION_COOKIE]) {
      sessionsStore.delete(cookies[SESSION_COOKIE]);
    }
    const devToken = request.headers['x-device-token'];
    if (devToken) sessionsStore.delete(devToken);
    clearSessionCookie(reply);
    return reply.send({ success: true, message: 'Logged out successfully' });
  });

  fastify.get('/api/auth/me', async (request, reply) => {
    const auth = request.auth || (await authenticateRequest(request));
    if (!auth) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    if (auth.type === 'user') {
      const userRole = auth.user.role || ((auth.user.username === 'admin' || auth.user.id === 'usr-admin') ? 'admin' : 'user');
      const userVehicles = isAdmin({ type: 'user', user: { ...auth.user, role: userRole } })
        ? vehiclesStore.map(v => v.id)
        : (auth.user.vehicles || [DEFAULT_VEHICLE_ID]);
      const userDevices = devicesStore.filter(d => d.userId === auth.user.id || userVehicles.includes(d.vehicleId));
      return reply.send({
        id: auth.user.id,
        username: auth.user.username,
        role: userRole,
        mustChangePassword: !!auth.user.mustChangePassword,
        vehicles: userVehicles,
        deviceCount: userDevices.length,
        ...(auth.session?.csrfToken ? { csrfToken: auth.session.csrfToken } : {})
      });
    }

    if (auth.type === 'device') {
      return reply.send({
        id: auth.device.id,
        name: auth.device.name,
        role: 'device',
        vehicleId: auth.vehicleId,
        mustChangePassword: false,
        vehicles: [auth.vehicleId],
        deviceCount: 1
      });
    }

    return reply.send({
      id: 'master',
      username: 'master-admin',
      role: 'admin',
      mustChangePassword: false,
      vehicles: vehiclesStore.map(v => v.id),
      deviceCount: devicesStore.length,
      ...(auth.session?.csrfToken ? { csrfToken: auth.session.csrfToken } : {})
    });
  });

  // ----- Device Pairing (QR & PIN flow) ------------------------------------

  fastify.post('/api/auth/device/initiate', {
    config: {
      rateLimit: {
        max: 10,
        timeWindow: '10 minutes'
      }
    }
  }, async (request, reply) => {
    cleanExpiredPairings();
    if (pendingPairingsByToken.size >= 50) {
      return reply.status(429).send({ error: 'Too many pending pairings. Please wait and try again.' });
    }

    let pin;
    do {
      pin = crypto.randomInt(100000, 1000000).toString();
    } while (pendingPairingsByCode.has(pin));

    const pairingCode = `${pin.slice(0, 3)}-${pin.slice(3)}`;
    const pollToken = `poll_${crypto.randomBytes(24).toString('hex')}`;

    const session = {
      code: pairingCode,
      normalizedCode: pin,
      pollToken,
      fingerprint: request.body?.fingerprint || {},
      status: 'pending',
      createdAt: Date.now(),
      expiresAt: Date.now() + 10 * 60 * 1000 // 10 minutes
    };

    pendingPairingsByCode.set(pairingCode, session);
    pendingPairingsByCode.set(pin, session);
    pendingPairingsByToken.set(pollToken, session);

    const publicDashboardUrl = (process.env.DASHBOARD_PUBLIC_URL || process.env.PUBLIC_DASHBOARD_URL || 'https://obd.hon2838.name.my').trim().replace(/\/+$/, '');
    return reply.send({
      pairingCode,
      pollToken,
      qrUrl: `${publicDashboardUrl}/pair?code=${pairingCode}`,
      expiresInSeconds: 600
    });
  });

  fastify.get('/api/auth/device/poll', {
    config: {
      rateLimit: {
        max: 500,
        timeWindow: '15 minutes'
      }
    }
  }, async (request, reply) => {
    const token = request.query?.token;
    if (!token || typeof token !== 'string') {
      return reply.status(400).send({ error: 'token query parameter is required' });
    }

    // Reject if passing a PIN or code — poll only accepts unguessable pollToken!
    const session = pendingPairingsByToken.get(token);
    if (!session || session.expiresAt < Date.now()) {
      return reply.status(404).send({ error: 'Invalid or expired poll token', status: 'expired' });
    }

    if (session.status === 'approved') {
      pendingPairingsByToken.delete(token);
      return reply.send({
        status: 'approved',
        deviceToken: session.deviceToken,
        vehicleId: session.vehicleId,
        vehicleName: session.vehicleName
      });
    }

    return reply.send({ status: 'pending' });
  });

  fastify.post('/api/auth/device/claim', {
    config: {
      rateLimit: {
        max: 10,
        timeWindow: '10 minutes'
      }
    }
  }, async (request, reply) => {
    const auth = request.auth || (await authenticateRequest(request));
    if (!auth) {
      return reply.status(401).send({ error: 'Authentication required: Sign in or provide API key to pair vehicle' });
    }

    const { pairingCode, vehicleId, newVehicleName, tankLitres } = request.body || {};
    if (!pairingCode || typeof pairingCode !== 'string') {
      return reply.status(400).send({ error: 'pairingCode is required' });
    }

    const normalized = pairingCode.replace(/[^0-9]/g, '');
    const session = pendingPairingsByCode.get(normalized) || pendingPairingsByCode.get(pairingCode.trim());
    if (!session || session.expiresAt < Date.now()) {
      return reply.status(404).send({ error: 'Invalid or expired pairing code' });
    }

    // Single-use check: must be pending. Atomically transition state before any async await
    if (session.status !== 'pending') {
      return reply.status(409).send({ error: 'Pairing session is no longer pending' });
    }
    session.status = 'claiming';

    // Serialized with every other store mutation so a concurrent vehicle
    // delete cannot interleave this claim's multi-file commit.
    return serializeMutation(async () => {
      try {
        let targetVehicleId = vehicleId;
        let newVeh = null;
        let candidateUsers = null;
        if (newVehicleName && typeof newVehicleName === 'string' && newVehicleName.trim().length > 0) {
          const trimmedName = newVehicleName.trim();
          if (trimmedName.length > 64) {
            session.status = 'pending';
            return reply.status(400).send({ error: 'Vehicle name cannot exceed 64 characters' });
          }
          const litres = typeof tankLitres === 'number' && tankLitres > 0 && tankLitres <= 2000 ? tankLitres : 40;
          targetVehicleId = 'veh-' + crypto.randomBytes(4).toString('hex');
          newVeh = {
            id: targetVehicleId,
            name: trimmedName,
            tankLitres: litres,
            ownerId: auth.type === 'user' ? auth.user.id : 'usr-admin',
            createdAt: Date.now()
          };
          candidateUsers = usersStore.map(user => {
            if (auth.type !== 'user' || user.id !== auth.user.id) return user;
            const assigned = Array.isArray(user.vehicles) ? [...user.vehicles] : [];
            if (!assigned.includes(targetVehicleId)) assigned.push(targetVehicleId);
            return { ...user, vehicles: assigned };
          });
        } else {
          // Existing vehicle: caller must have authorized access
          if (!targetVehicleId || !vehicleExists(targetVehicleId)) {
            targetVehicleId = DEFAULT_VEHICLE_ID;
          }
          if (!canAccessVehicle(auth, targetVehicleId)) {
            session.status = 'pending';
            return reply.status(403).send({ error: 'Vehicle access denied: Not authorized to pair this vehicle' });
          }
        }

        const rawDeviceToken = `obd_dev_${crypto.randomBytes(24).toString('hex')}`;
        const tokenHash = crypto.createHash('sha256').update(rawDeviceToken).digest('hex');
        const device = {
          id: `dev-${crypto.randomBytes(4).toString('hex')}`,
          name: session.fingerprint?.deviceModel || 'Car Head Unit',
          tokenHash,
          tokenPrefix: rawDeviceToken.slice(0, 12),
          tokenSuffix: rawDeviceToken.slice(-4),
          vehicleId: targetVehicleId,
          userId: auth.type === 'user' ? auth.user.id : 'usr-admin',
          fingerprint: session.fingerprint,
          createdAt: Date.now(),
          lastSeenAt: Date.now()
        };

        // Vehicle registry, user assignment and device issuance commit as
        // one durable transaction: a failed write leaves no orphan vehicle
        // or token on disk, and memory is only updated afterwards.
        const claimEntries = [];
        if (newVeh) claimEntries.push([VEHICLES_PATH, vehiclesStore.concat(newVeh)]);
        if (newVeh && auth.type === 'user' && !(auth.user.vehicles || []).includes(targetVehicleId)) {
          claimEntries.push([USERS_PATH, candidateUsers]);
        }
        claimEntries.push([DEVICES_PATH, devicesStore.concat(device)]);
        runFileTransactionSync(claimEntries);

        if (newVeh) {
          vehiclesStore.push(newVeh);
          if (auth.type === 'user') {
            if (!auth.user.vehicles) auth.user.vehicles = [];
            if (!auth.user.vehicles.includes(targetVehicleId)) {
              auth.user.vehicles.push(targetVehicleId);
            }
          }
          invalidateAnalyticsCaches({ vehicles: true });
        }
        devicesStore.push(device);

        // Remove pairing code from pending map so it cannot be claimed again
        pendingPairingsByCode.delete(session.code);
        pendingPairingsByCode.delete(session.normalizedCode);

        const vehName = vehiclesStore.find(v => v.id === targetVehicleId)?.name || 'Default Vehicle';
        session.status = 'approved';
        session.deviceToken = rawDeviceToken;
        session.vehicleId = targetVehicleId;
        session.vehicleName = vehName;

        return reply.send({
          success: true,
          deviceId: device.id,
          vehicleId: targetVehicleId,
          vehicleName: vehName,
          deviceToken: rawDeviceToken
        });
      } catch (err) {
        if (!getIsPoisoned()) {
          session.status = 'pending';
        }
        return retryablePersistenceError(reply, request, err);
      }
    });
  });

  // ----- Paired Devices Management -----------------------------------------

  fastify.get('/api/devices', async (request, reply) => {
    const auth = request.auth || (await authenticateRequest(request));
    let list = devicesStore;
    if (!isAdmin(auth)) {
      const scope = vehicleScope(auth);
      list = devicesStore.filter(d => d.userId === auth?.user?.id || (scope && scope.includes(d.vehicleId)));
    }
    const result = list.map(d => ({
      id: d.id,
      name: d.name,
      vehicleId: d.vehicleId,
      vehicleName: vehiclesStore.find(v => v.id === d.vehicleId)?.name || 'Unknown',
      fingerprint: d.fingerprint,
      createdAt: d.createdAt,
      lastSeenAt: d.lastSeenAt,
      tokenMasked: d.tokenPrefix ? `${d.tokenPrefix}...${d.tokenSuffix}` : (d.deviceToken ? `${d.deviceToken.slice(0, 12)}...${d.deviceToken.slice(-4)}` : 'N/A')
    }));
    return reply.send(result);
  });

  fastify.delete('/api/devices/:id', async (request, reply) => {
    const auth = request.auth || (await authenticateRequest(request));
    const idx = devicesStore.findIndex(d => d.id === request.params.id);
    if (idx === -1) {
      return reply.status(404).send({ error: 'Device not found' });
    }

    const device = devicesStore[idx];
    const isOwner = auth?.type === 'user' && (device.userId === auth.user.id || (auth.user.vehicles || []).includes(device.vehicleId));
    if (!isAdmin(auth) && !isOwner) {
      return reply.status(403).send({ error: 'Device access denied' });
    }

    // Token revocation is a single-file atomic persist, serialized with the
    // device-claim transaction so a concurrent claim cannot interleave and
    // resurrect or lose a revocation.
    return serializeMutation(async () => {
      const liveIdx = devicesStore.findIndex(d => d.id === request.params.id);
      if (liveIdx === -1) {
        return reply.status(404).send({ error: 'Device not found' });
      }
      const candidateDevices = devicesStore.filter((_, index) => index !== liveIdx);
      try {
        await persist(DEVICES_PATH, candidateDevices);
      } catch (err) {
        return retryablePersistenceError(reply, request, err);
      }
      replaceArrayContents(devicesStore, candidateDevices);
      return reply.send({ success: true, message: 'Device revoked successfully' });
    });
  });
}

module.exports = authRoutes;
