import { World } from './World/World.js';
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

// socket.on('pong_test', (data) => {
//     const roundTrip = Date.now() - data.clientTime;
//     console.log(`Round-trip delay: ${roundTrip} ms`);
// });

async function main() {
    const container = document.querySelector('#scene-container');
    const world = new World(container);
    world.start();
}

main().catch((err) => {
    console.error(err);
});