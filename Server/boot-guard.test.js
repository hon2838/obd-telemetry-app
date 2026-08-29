// Boot-time guard test. Spawns a child node process that imports
// server.js without OBD_API_KEY set, and asserts the process
// exits non-zero with the expected error message.
const { spawnSync } = require('child_process');
const path = require('path');

describe('Boot-time guard', () => {
  it('refuses to start without OBD_API_KEY', () => {
    const result = spawnSync(
      process.execPath,
      [path.join(__dirname, 'server.js')],
      { encoding: 'utf-8', env: { ...process.env, OBD_API_KEY: '' } },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr + result.stdout).toMatch(/OBD_API_KEY/);
  });

  it('refuses to start with a too-short OBD_API_KEY', () => {
    const result = spawnSync(
      process.execPath,
      [path.join(__dirname, 'server.js')],
      { encoding: 'utf-8', env: { ...process.env, OBD_API_KEY: 'short' } },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr + result.stdout).toMatch(/< 32 chars/);
  });
});
