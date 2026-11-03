import { createServer } from 'node:http';
import { Server } from 'socket.io';

const server = createServer();
const io = new Server(server, {
  cors: {
    origin: "*", // Allows your phone browser to connect
    methods: ["GET", "POST"]
  }
});

io.on('connection', (socket) => {
  console.log(`A device connected! ID: ${socket.id}`);

  // Listen for latency ping from phone/browser
  socket.on('ping_test', (data) => {
    const serverReceiveTime = Date.now();
    const networkDelay = serverReceiveTime - data.clientTime;
    console.log(`Phone-to-Laptop Latency: ${networkDelay} ms`);
    
    // Echo it back
    socket.emit('pong_test', data);
  });

  socket.on('disconnect', () => {
    console.log('Device disconnected');
  });
});

// Bind to 0.0.0.0 so your phone can reach it over the hotspot
// server.listen(3000, '0.0.0.0', () => {
//   console.log('WebSocket server running on http://0.0.0.0:3000');
// });