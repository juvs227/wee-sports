import { World } from './World/World.js';
import { connectSwings } from './network/swingConnection.js';

async function main() {
    const container = document.querySelector('#scene-container');
    const world = new World(container);
    world.start();
    const params = new URLSearchParams(location.search);
    const room = params.get('room') || crypto.randomUUID().slice(0, 8);
    if (!/^[a-zA-Z0-9-]{6,40}$/.test(room)) throw new Error('Room must be 6–40 letters, numbers, or hyphens');
    const url = new URL(location.href);
    url.searchParams.set('room', room);
    history.replaceState(null, '', url);
    const panel = document.createElement('aside');
    panel.style.cssText = 'position:fixed;top:16px;left:16px;max-width:340px;background:#182329ee;color:white;padding:18px;border-radius:12px;font:15px system-ui;z-index:1';
    const heading = document.createElement('h2');
    heading.textContent = 'Phone swing controller';
    heading.style.margin = '0 0 12px';
    const code = document.createElement('p');
    code.textContent = `Room: ${room}`;
    const status = document.createElement('p');
    const result = document.createElement('p');
    result.textContent = 'Waiting for a phone swing…';
    const link = document.createElement('a');
    const controllerUrl = new URL('/controller.html', import.meta.env.PUBLIC_ORIGIN || location.origin);
    controllerUrl.searchParams.set('room', room);
    link.href = controllerUrl.href;
    link.textContent = 'Open phone controller';
    link.style.color = '#86efac';
    const instructions = document.createElement('p');
    instructions.textContent = controllerUrl.protocol === 'https:'
      ? 'Send the controller link above to your phone. Both devices use this room.'
      : 'For an iPhone link, restart the app with NGROK_HOST set to your tunnel hostname, then refresh this page.';
    panel.append(heading, code, status, result, link, instructions);
    document.body.append(panel);
    const connection = connectSwings({ room, role: 'game',
      onStatus: text => { status.textContent = text; },
      onSwing: event => {
        world.swing(event);
        result.textContent = `${event.hand} · ${event.label}`;
      },
    });
    window.addEventListener('pagehide', () => connection.close(), { once: true });
}

main().catch((err) => {
    console.error(err);
});
