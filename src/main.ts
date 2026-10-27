import { World } from './World/World';
import { InputController } from './Controllers/inputController';
import { connectSwings } from './network/swingConnection.js';

async function main(): Promise<void> {
    const container = document.querySelector('#scene-container');
    if (!container) {
        throw new Error('Could not find scene-container element');
    }

    const world = new World(container as HTMLElement);
    world.start();
    new InputController((input) => {
        world.setPlayerInput(input, 1);
    });

    const params = new URLSearchParams(location.search);
    const room = params.get('room') || crypto.randomUUID().slice(0, 8);
    if (!/^[a-zA-Z0-9-]{6,40}$/.test(room)) {
        throw new Error('Room must be 6-40 letters, numbers, or hyphens');
    }

    const url = new URL(location.href);
    url.searchParams.set('room', room);
    history.replaceState(null, '', url);

    const panel = document.createElement('aside');
    panel.style.cssText =
        'position:fixed;top:16px;left:16px;max-width:340px;' +
        'background:#182329ee;color:white;padding:18px;border-radius:12px;' +
        'font:15px system-ui;z-index:1';

    const heading = document.createElement('h2');
    heading.textContent = 'Phone swing controller';
    heading.style.margin = '0 0 12px';

    const code = document.createElement('p');
    code.textContent = `Room: ${room}`;

    const status = document.createElement('p');
    const result = document.createElement('p');
    result.textContent = 'Waiting for a phone swing…';

    const link = document.createElement('a');
    const controllerUrl = new URL('/controller.html', location.origin);
    controllerUrl.searchParams.set('room', room);
    link.href = controllerUrl.href;
    link.textContent = 'Open phone controller';
    link.style.color = '#86efac';

    panel.append(heading, code, status, result, link);
    document.body.append(panel);

    const connection = connectSwings({
        room,
        role: 'game',
        onStatus: (text) => {
            status.textContent = text;
        },
        onSwing: (event) => {
            world.swing(event);
            result.textContent = `${event.hand} · ${event.label}`;
        },
    });

    window.addEventListener('pagehide', () => connection.close(), { once: true });
}

main().catch((err: unknown) => {
    console.error(err);
});
