// A separate process keeps the load generator off the server's event loop.
// This uses the normal application, bound only to an unused loopback port.
import { createGameServer } from '../src/app.js';

const app = createGameServer();
app.http.listen(0, '127.0.0.1', () => {
  process.send({ port: app.http.address().port });
});
let closing = false;
function close() {
  if (closing) return;
  closing = true;
  app.close().then(() => process.exit(0));
}
process.on('SIGTERM', close);
process.on('SIGINT', close);
process.on('disconnect', close);
