import { createGameServer } from './app.js';
const origins = (process.env.CLIENT_ORIGIN ?? '').split(',').map(value => value.trim()).filter(Boolean);
const port = Number(process.env.PORT ?? 3001);
const app = createGameServer({ origins });
app.http.listen(port, () => console.log(`Wee Sports server listening on http://localhost:${port}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => app.close().then(() => process.exit(0)));
