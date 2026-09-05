const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

function passwordHash(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

test('startup rotates the known legacy admin password and preserves a backup', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'obd-test-bootstrap-'));
  const salt = crypto.randomBytes(16).toString('hex');
  const usersPath = path.join(dataDir, 'users.json');

  fs.writeFileSync(usersPath, JSON.stringify([{
    id: 'usr-admin',
    username: 'admin',
    passwordSalt: salt,
    passwordHash: passwordHash('admin12345', salt),
    vehicles: ['default'],
    createdAt: Date.now()
  }], null, 2));

  const result = spawnSync(process.execPath, ['-e', "require('./server')"], {
    cwd: __dirname,
    env: {
      ...process.env,
      OBD_API_KEY: 'b'.repeat(64),
      OBD_DATA_DIR: dataDir,
      OBD_INITIAL_ADMIN_PASSWORD: ''
    },
    encoding: 'utf8',
    timeout: 10_000
  });

  expect(result.status).toBe(0);
  const [admin] = JSON.parse(fs.readFileSync(usersPath, 'utf8'));
  expect(admin.role).toBe('admin');
  expect(admin.mustChangePassword).toBe(true);
  expect(passwordHash('admin12345', admin.passwordSalt)).not.toBe(admin.passwordHash);

  const temporaryPassword = fs.readFileSync(path.join(dataDir, '.initial_admin_secret'), 'utf8').trim();
  expect(temporaryPassword).toHaveLength(32);
  expect(passwordHash(temporaryPassword, admin.passwordSalt)).toBe(admin.passwordHash);
  expect(fs.statSync(path.join(dataDir, '.initial_admin_secret')).mode & 0o777).toBe(0o600);
  expect(fs.readdirSync(dataDir).some(name => name.startsWith('users.json.bak.'))).toBe(true);

  fs.rmSync(dataDir, { recursive: true, force: true });
});
