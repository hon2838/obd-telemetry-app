// Agent and APK distribution routes plugin
const fs = require('fs');

async function agentRoutes(fastify, options) {
  const { apkDownloadPath, installScriptPath, readApkVersion } = options;

  fastify.get('/api/agent/latest', async (request, reply) => {
    const info = readApkVersion ? readApkVersion() : null;
    if (!info) {
      return reply.status(404).send({
        error: 'No APK baked into this image. Run `make apk-bundle` to bundle one.',
      });
    }
    return reply.send({
      download_url: '/api/agent/latest.apk',
      ...info,
    });
  });

  fastify.get('/api/agent/latest.apk', async (request, reply) => {
    if (!fs.existsSync(apkDownloadPath)) {
      return reply.status(404).send({
        error: 'No APK baked into this image. Run `make apk-bundle` to bundle one.',
      });
    }
    const stat = fs.statSync(apkDownloadPath);
    const info = (readApkVersion ? readApkVersion() : null) || {};
    const filename = `obd-telemetry-agent-${info.versionName || 'unknown'}.apk`;
    reply.header('Content-Type', 'application/vnd.android.package-archive');
    reply.header('Content-Length', stat.size);
    reply.header('Content-Disposition', `attachment; filename="${filename}"`);
    reply.header('Cache-Control', 'public, max-age=60');
    return reply.send(fs.createReadStream(apkDownloadPath));
  });

  fastify.get('/install.sh', async (request, reply) => {
    if (!fs.existsSync(installScriptPath)) {
      return reply.status(404).send(
        '#!/bin/sh\n' +
        'echo "install.sh is not bundled in this server image."\n' +
        'echo "See https://github.com/hon2838/obd-telemetry-app for the script."\n' +
        'exit 1\n'
      );
    }
    reply.header('Content-Type', 'text/x-shellscript');
    reply.header('Cache-Control', 'no-store');
    return reply.send(fs.createReadStream(installScriptPath));
  });
}

module.exports = agentRoutes;
