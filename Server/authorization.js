// Route-independent authentication and resource authorization.
// The backend remains the security boundary even when the dashboard proxy is bypassed.

function isAdmin(auth) {
  if (!auth) return false;
  if (auth.type === 'master') return true;
  if (auth.type === 'user') return auth.user.role === 'admin' || auth.user.id === 'usr-admin';
  return false;
}

function canAccessVehicle(auth, vehicleId) {
  if (!auth) return false;
  if (isAdmin(auth)) return true;
  if (auth.type === 'device') {
    return auth.vehicleId === vehicleId;
  }
  if (auth.type === 'user') {
    return Array.isArray(auth.user.vehicles) && auth.user.vehicles.includes(vehicleId);
  }
  return false;
}

function vehicleScope(auth) {
  if (!auth) return [];
  if (isAdmin(auth)) return null; // null represents all vehicles for admin/master
  if (auth.type === 'device') return [auth.vehicleId];
  if (auth.type === 'user') return auth.user.vehicles || [];
  return [];
}

function installAuthorization(fastify, stores, authenticate) {
  const publicRoutes = new Set([
    'GET /healthz',
    'HEAD /healthz',
    'GET /install.sh',
    'HEAD /install.sh',
    'GET /api/agent/latest',
    'HEAD /api/agent/latest',
    'GET /api/agent/latest.apk',
    'HEAD /api/agent/latest.apk',
    'POST /api/auth/login',
    'POST /api/auth/device/initiate',
    'GET /api/auth/device/poll',
    'HEAD /api/auth/device/poll',
  ]);

  const resetRoutes = new Set([
    '/api/auth/me',
    '/api/auth/change-password',
    '/api/auth/logout',
  ]);

  const ingestBatchRoutes = new Set([
    '/api/telemetry/batch',
    '/api/telemetry/dtc',
    '/api/telemetry/dtc/clear',
    '/api/dtc',
    '/api/dtc/clear',
    '/api/fuel-logs',
    '/api/maintenance',
  ]);

  fastify.decorateRequest('auth', null);

  fastify.addHook('preHandler', async (request, reply) => {
    const routeUrl = request.routeOptions?.url;
    // Let 404 handler deal with non-existent routes
    if (!routeUrl) return;

    const methodAndRoute = `${request.method} ${routeUrl}`;
    if (publicRoutes.has(methodAndRoute) || request.method === 'OPTIONS') {
      return;
    }

    const auth = await authenticate(request);
    if (!auth) {
      return reply.code(401).send({ error: 'Authentication required' });
    }

    request.auth = auth;
    reply.header('Cache-Control', 'no-store');

    // Browser cookies are ambient credentials. Require the token bound to
    // the server-side session for every state-changing request. Bearer,
    // Basic, device-token, and API-key clients retain their existing contract.
    if (auth.via === 'cookie' && request.method !== 'GET' && request.method !== 'HEAD' && request.method !== 'OPTIONS') {
      const csrf = request.headers['x-csrf-token'];
      if (!auth.session?.csrfToken || typeof csrf !== 'string' || csrf !== auth.session.csrfToken) {
        return reply.code(403).send({ error: 'Invalid CSRF token', code: 'CSRF_REQUIRED' });
      }
    }

    // If user is flagged mustChangePassword, only allow password/profile/logout endpoints
    if (auth.type === 'user' && auth.user.mustChangePassword && !resetRoutes.has(routeUrl)) {
      return reply.code(403).send({
        error: 'Change your password before continuing',
        code: 'PASSWORD_CHANGE_REQUIRED',
      });
    }

    // Devices may read their own vehicle telemetry and upload records,
    // but cannot manage accounts, pair devices, modify the garage, or issue commands.
    if (auth.type === 'device') {
      const isGetOrHead = request.method === 'GET' || request.method === 'HEAD';
      const allowedReads =
        routeUrl.startsWith('/api/telemetry/') ||
        routeUrl.startsWith('/api/drives') ||
        routeUrl.startsWith('/api/performance/') ||
        routeUrl.startsWith('/api/trips/') ||
        routeUrl.startsWith('/api/dtc/lookup') ||
        routeUrl.startsWith('/api/maintenance') ||
        routeUrl === '/api/commands/pending' ||
        ['/api/fuel-logs', '/api/fuel-stats', '/api/vehicles'].includes(routeUrl);

      const isAllowedPost =
        request.method === 'POST' && (ingestBatchRoutes.has(routeUrl) || routeUrl === '/api/dtc/lookup' || routeUrl === '/api/commands/ack');

      if (!(isGetOrHead && allowedReads) && !isAllowedPost) {
        return reply.code(403).send({ error: 'Device credentials cannot perform this action' });
      }
    }

    if (routeUrl === '/api/commands/pending' || routeUrl === '/api/commands/ack') {
      if (request.headers['x-obd-command-protocol'] !== '2') {
        return reply.code(426).send({ error: 'Command protocol v2 is required' });
      }
      if (auth.type !== 'device') {
        return reply.code(403).send({ error: 'Only paired devices can deliver or acknowledge commands' });
      }
    }
    if (routeUrl === '/api/commands/status' && auth.type === 'device') {
      return reply.code(403).send({ error: 'Device credentials cannot view command status' });
    }

    // Vehicle query parameter scoping (?vehicle=vid)
    if (request.query?.vehicle !== undefined && request.query?.vehicle !== null && request.query?.vehicle !== '') {
      if (!canAccessVehicle(auth, request.query.vehicle)) {
        return reply.code(403).send({ error: 'Vehicle access denied' });
      }
    }

    // Ingest and command mutation checks. A paired device always inherits
    // its assigned vehicle. A non-admin user may omit vehicleId only when
    // exactly one vehicle is available; write that resolved id into the
    // payload so route handlers cannot accidentally fall back to "default".
    if (request.method === 'POST' && (ingestBatchRoutes.has(routeUrl) || routeUrl === '/api/commands')) {
      if (routeUrl === '/api/commands') {
        if (auth.type === 'device') {
          return reply.code(403).send({ error: 'Device credentials cannot issue commands' });
        }
        let target = request.body?.vehicleId;
        if (!target && auth.type === 'user' && !isAdmin(auth)) {
          const scope = vehicleScope(auth);
          if (scope.length !== 1) {
            return reply.code(400).send({ error: 'vehicleId is required when more than one vehicle is available' });
          }
          target = scope[0];
          request.body.vehicleId = target;
        }
        target ||= 'default';
        if (!canAccessVehicle(auth, target)) {
          return reply.code(403).send({ error: 'Vehicle access denied' });
        }
      } else {
        const records = Array.isArray(request.body) ? request.body : [request.body];
        for (const record of records) {
          if (!record || typeof record !== 'object') continue;
          let target = record.vehicleId;
          if (!target && auth.type === 'device') {
            target = auth.vehicleId;
            record.vehicleId = target;
          } else if (!target && auth.type === 'user' && !isAdmin(auth)) {
            const scope = vehicleScope(auth);
            if (scope.length !== 1) {
              return reply.code(400).send({ error: 'vehicleId is required when more than one vehicle is available' });
            }
            target = scope[0];
            record.vehicleId = target;
          }
          target ||= 'default';
          if (!canAccessVehicle(auth, target)) {
            return reply.code(403).send({ error: 'Vehicle access denied' });
          }
        }
      }
    }

    // Parameterized resource-level authorizations
    if (routeUrl === '/api/vehicles/:id') {
      const resource = stores.getVehicle(request.params.id);
      if (resource && !canAccessVehicle(auth, resource.id)) {
        return reply.code(403).send({ error: 'Vehicle access denied' });
      }
      if (request.query?.reassign && !canAccessVehicle(auth, request.query.reassign)) {
        return reply.code(403).send({ error: 'Destination vehicle access denied' });
      }
    } else if (routeUrl === '/api/devices/:id') {
      const resource = stores.getDevice(request.params.id);
      if (resource) {
        const isOwner = auth.type === 'user' && (resource.userId === auth.user.id || (auth.user.vehicles || []).includes(resource.vehicleId));
        if (!isAdmin(auth) && !isOwner) {
          return reply.code(403).send({ error: 'Device access denied' });
        }
      }
    } else if (routeUrl === '/api/fuel-logs/:id') {
      const resource = stores.getFuelLog(request.params.id);
      if (resource && !canAccessVehicle(auth, resource.vehicleId || 'default')) {
        return reply.code(403).send({ error: 'Vehicle access denied' });
      }
    } else if (routeUrl === '/api/maintenance/:id') {
      const resource = stores.getMaintenanceItem(request.params.id);
      if (resource && !canAccessVehicle(auth, resource.vehicleId || 'default')) {
        return reply.code(403).send({ error: 'Vehicle access denied' });
      }
    } else if (routeUrl === '/api/drives/:id/export/csv' || routeUrl === '/api/drives/:id/export/gpx') {
      const resource = stores.getDrive(request.params.id);
      if (resource && !canAccessVehicle(auth, resource.vehicleId || 'default')) {
        return reply.code(403).send({ error: 'Vehicle access denied' });
      }
    }
  });
}

module.exports = {
  installAuthorization,
  canAccessVehicle,
  vehicleScope,
  isAdmin,
};
