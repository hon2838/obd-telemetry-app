// Tests for the /api/agent/* APK download routes. These run
// without a real APK baked in (the developer build doesn't
// have one). The tests assert:
//   - GET /api/agent/latest returns either a populated JSON
//     object (when a real APK is baked) or a 404 with a
//     clear error message.
//   - GET /api/agent/latest.apk is similarly permissive.
//
// One file so afterAll only closes fastify once at the end
// (otherwise the second describe can't inject after the
// first has closed it).
const TEST_API_KEY = 'a'.repeat(64);
process.env.OBD_API_KEY = TEST_API_KEY;
const { fastify } = require('./server');

describe('GET /api/agent/latest', () => {
  it('returns either a populated JSON or a 404 with a clear error', async () => {
    const response = await fastify.inject({ method: 'GET', url: '/api/agent/latest' });
    if (response.statusCode === 200) {
      const body = JSON.parse(response.payload);
      expect(body.download_url).toBe('/api/agent/latest.apk');
      expect(typeof body.size_bytes).toBe('number');
      expect(body.size_bytes).toBeGreaterThan(0);
    } else {
      // No APK baked into this image (developer build). The
      // 404 must include a useful error message rather than
      // an empty body or a stack trace.
      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.payload);
      expect(body.error).toMatch(/APK|apk-bundle/);
    }
  });
});

describe('GET /api/agent/latest.apk', () => {
  it('returns 200 with the APK binary if baked, 404 with a clear error otherwise', async () => {
    const response = await fastify.inject({ method: 'GET', url: '/api/agent/latest.apk' });
    if (response.statusCode === 200) {
      // A real APK is in the image. Content-Type and the
      // Content-Disposition header should be set so the
      // browser offers a download with a sensible filename.
      const ct = response.headers['content-type'];
      expect(ct).toMatch(/android.package-archive/);
      const cd = response.headers['content-disposition'];
      expect(cd).toMatch(/attachment.*\.apk/);
      // The body should be non-trivial.
      expect(response.rawPayload.length).toBeGreaterThan(100000);
    } else {
      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.payload);
      expect(body.error).toMatch(/APK|apk-bundle/);
    }
  });
});

afterAll(async () => {
  await fastify.close();
});
