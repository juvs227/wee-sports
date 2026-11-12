import {test, expect} from 'vitest';
import {once} from 'node:events';
import {createOrientationTestServer} from '../../tools/orientation-test/server.js';

test('orientation tool exposes only its public page and sensor modules', async () => {
  const {server, relay} = createOrientationTestServer();
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const path of ['/', '/src/controller/orientationCalibration.js', '/src/controller/androidCalibration.js', '/src/controller/iosCalibration.js']) {
      expect((await fetch(base + path)).status).toBe(200);
    }
    for (const path of ['/package.json', '/.env', '/server/main.js', '/tools/orientation-test/../../../package.json']) {
      expect((await fetch(base + path)).status).toBe(404);
    }
  } finally {
    await new Promise(resolve => relay.close(resolve));
    await new Promise(resolve => server.close(resolve));
  }
});
