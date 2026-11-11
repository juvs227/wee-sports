// A separate process keeps the load generator off the server's event loop.
// This uses the normal application, bound only to an unused loopback port.
import { createGameServer } from '../src/app.js';
import {monitorEventLoopDelay} from 'node:perf_hooks';

const app = createGameServer();
// Test-only IPC. Resource measurements are never exposed by the web service.
const measurements = process.env.WEE_STRESS_METRICS === '1' ? monitorEventLoopDelay({resolution: 20}) : null;
measurements?.enable();
process.on('message', message => {
  if (!measurements || message?.type !== 'metrics') return;
  if (message.collect && global.gc) global.gc();
  const resources = {};
  for (const name of process.getActiveResourcesInfo()) resources[name] = (resources[name] || 0) + 1;
  const sockets = [...app.io.sockets.sockets.values()];
  const listeners = emitter => emitter.eventNames().reduce((count, event) => count + emitter.listenerCount(event), 0);
  process.send({type: 'metrics', id: message.id, memory: process.memoryUsage(), resources,
    rooms: app.store.roomCount, sockets: sockets.length, engineClients: app.io.engine.clientsCount,
    socketListeners: sockets.reduce((sum, socket) => sum + listeners(socket), 0),
    serverListeners: {http: listeners(app.http), socketIO: listeners(app.io), engine: listeners(app.io.engine)},
    eventLoopMs: {p50: measurements.percentile(50) / 1e6, p95: measurements.percentile(95) / 1e6, max: measurements.max / 1e6}});
  measurements.reset();
});
app.http.listen(0, '127.0.0.1', () => {
  process.send({ port: app.http.address().port });
});
let closing = false;
function close() {
  if (closing) return;
  closing = true;
  measurements?.disable();
  app.close().then(() => process.exit(0));
}
process.on('SIGTERM', close);
process.on('SIGINT', close);
process.on('disconnect', close);
