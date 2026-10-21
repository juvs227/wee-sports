// src/main.ts
import { World } from './World/World';
import { InputController } from './Controllers/inputController';
import { io } from 'socket.io-client';

// Automatically connects to your backend server on port 3000 using your current network hostname/IP
// const socket = io(`http://${window.location.hostname}:3000`);

// socket.on('connect', () => {
//     console.log('Connected to WebSocket server!', socket.id);

//     // Send a ping test every 1 second to measure responsiveness
//     setInterval(() => {
//         socket.emit('ping_test', { clientTime: Date.now() });
//     }, 1000);
// });

// socket.on('pong_test', (data: { clientTime: number }) => {
//     const roundTrip = Date.now() - data.clientTime;
//     console.log(`Round-trip delay: ${roundTrip} ms`);
// });

async function main(): Promise<void> {
    const container = document.querySelector('#scene-container');
    if (!container) {
        throw new Error('Could not find scene-container element');
    }

    // Cast container to HTMLElement so TypeScript is satisfied
    const world = new World(container as HTMLElement);
    world.start();
    const inputController = new InputController((input) => {
    world.setPlayerInput(input, 1); // Updates Player 1 controls
});
}

main().catch((err: unknown) => {
    console.error(err);
});