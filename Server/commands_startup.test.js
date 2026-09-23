const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

describe('command queue startup integrity', () => {
  it.each([
    ['malformed JSON', '{bad json'],
    ['wrong root type', '{}'],
    ['duplicate IDs', JSON.stringify([
      { id: 'same-id', command: 'read_dtc', vehicleId: 'default', status: 'pending' },
      { id: 'same-id', command: 'clear_dtc', vehicleId: 'default', status: 'pending' }
    ])]
  ])('stops rather than discarding a %s queue', (_name, contents) => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'obd-command-startup-'));
    const queuePath = path.join(dataDir, 'commands_queue.json');
    try {
      fs.writeFileSync(queuePath, contents);
      const child = spawnSync(process.execPath, ['-e', "require('./server')"], {
        cwd: __dirname,
        env: { ...process.env, OBD_DATA_DIR: dataDir, OBD_API_KEY: 'a'.repeat(64) },
        encoding: 'utf8',
        timeout: 10000
      });
      expect(child.status).not.toBe(0);
      expect(fs.readFileSync(queuePath, 'utf8')).toBe(contents);
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
