// Exercise the real proxy against a slow HTTP backend, including denial paths.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const { NextRequest } = require('next/server');

async function main() {
  const server = http.createServer((req, res) => {
    const cookie = req.headers.cookie;
    if (cookie === 'obd_session=slow') {
      const timer = setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ mustChangePassword: false }));
      }, 6000);
      res.on('close', () => clearTimeout(timer));
    } else if (cookie === 'obd_session=stalled') {
      // Leave the socket open until the proxy's abort deadline closes it.
    } else {
      res.writeHead(cookie === 'obd_session=invalid' ? 401 : 503, { 'Content-Type': 'application/json' });
      res.end('{}');
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  process.env.INTERNAL_API_URL = `http://127.0.0.1:${server.address().port}`;
  const filename = path.resolve(__dirname, '../proxy.ts');
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const compiled = new Module(filename, module);
  compiled.filename = filename;
  compiled.paths = Module._nodeModulePaths(path.dirname(filename));
  compiled._compile(output, filename);
  const request = session => new NextRequest('https://dashboard.example/api/telemetry/latest', {
    headers: { Cookie: `obd_session=${session}` },
  });
  try {
    const slow = await compiled.exports.proxy(request('slow'));
    assert.equal(slow.headers.get('x-middleware-next'), '1', 'A valid six-second auth response must proceed');
    const invalid = await compiled.exports.proxy(request('invalid'));
    assert.equal(invalid.status, 401, 'Invalid credentials must remain denied');
    const unavailable = await compiled.exports.proxy(request('unavailable'));
    assert.equal(unavailable.status, 503, 'Unavailable authentication must fail closed');
    const started = performance.now();
    const stalled = await compiled.exports.proxy(request('stalled'));
    assert.equal(stalled.status, 503, 'A stalled authentication request must fail closed');
    assert.ok(performance.now() - started < 18000, 'Authentication must keep a bounded deadline');
    console.log('Authentication timeout regression checks passed: slow valid session, denial, outage and stalled backend.');
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
