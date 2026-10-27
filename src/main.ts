import { World } from './World/World';
import { InputController } from './Controllers/inputController';
import { connectSwings } from './network/swingConnection.js';

async function main(): Promise<void> {
    const container = document.querySelector('#scene-container');
    if (!container) {
        throw new Error('Could not find scene-container element');
    }

    const world = new World(container as HTMLElement);
    let lobbyPaused = window.parent !== window;
    if (!lobbyPaused) world.start();
    window.addEventListener('message', event => {
        if (event.source !== window.parent || event.origin !== location.origin ||
            event.data?.type !== 'wee:lobby-state' || typeof event.data.paused !== 'boolean') return;
        lobbyPaused = event.data.paused;
        if (lobbyPaused) {
            world.setPlayerInput({ moveX: 0, moveZ: 0 }, 1);
            world.stop();
        }
        else world.start();
    });
    new InputController((input) => {
        world.setPlayerInput(lobbyPaused ? { moveX: 0, moveZ: 0 } : input, 1);
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
    result.textContent = 'J/K: swing · B: practice feed · H: hitboxes';
    world.onSwingFeedback = message => { result.textContent = message; };
    const help = document.createElement('p');
    help.style.fontSize = '12px';
    help.textContent = 'Disable Auto position for WASD movement · J/K: backhand/forehand · B: forehand feed · Shift+B: backhand feed · N / Shift+N: feed bot · H: hitboxes. Amber: inactive, blue: strike window, green: hit.';

    const link = document.createElement('a');
    const controllerUrl = new URL('/controller.html', __PUBLIC_ORIGIN__ || location.origin);
    controllerUrl.searchParams.set('room', room);
    link.href = controllerUrl.href;
    link.textContent = 'Open phone controller';
    link.style.color = '#86efac';
    if (window.parent !== window) link.hidden = true; // Phones already joined through the lobby.

    const autoLabel = document.createElement('label');
    autoLabel.style.cssText = 'display:block;margin:12px 0';
    const autoToggle = document.createElement('input');
    autoToggle.type = 'checkbox';
    autoToggle.checked = world.autoPositionEnabled;
    autoToggle.addEventListener('change', () => { world.autoPositionEnabled = autoToggle.checked; });
    autoLabel.append(autoToggle, ' Auto position · both players');
    const botLabel = document.createElement('label');
    botLabel.style.cssText = 'display:block;margin:12px 0';
    const botToggle = document.createElement('input');
    botToggle.type = 'checkbox';
    botToggle.checked = world.botEnabled;
    botToggle.addEventListener('change', () => { world.botEnabled = botToggle.checked; });
    botLabel.append(botToggle, ' Player 2 bot');
    panel.append(heading, code, status, result, autoLabel, botLabel, link, help);
    document.body.append(panel);

    const connection = connectSwings({
        room,
        role: 'game',
        onStatus: (text) => {
            status.textContent = text;
        },
        onSwing: (event) => {
            if (!lobbyPaused) world.swing(event);

        },
    });

    window.addEventListener('pagehide', () => connection.close(), { once: true });
}

main().catch((err: unknown) => {
    console.error(err);
});
