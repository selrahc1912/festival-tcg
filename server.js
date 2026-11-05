const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

let waitingPlayer = null;

io.on('connection', (socket) => {
  console.log('Un joueur s\'est connecté :', socket.id);

  socket.on('find_match', (playerData) => {
    if (waitingPlayer) {
      const roomName = 'room_' + socket.id + '_' + waitingPlayer.id;
      socket.join(roomName);
      waitingPlayer.join(roomName);

      io.to(roomName).emit('match_found', {
        room: roomName,
        players: [
          { id: waitingPlayer.id, data: waitingPlayer.data },
          { id: socket.id, data: playerData }
        ]
      });

      waitingPlayer = null;
    } else {
      waitingPlayer = socket;
      waitingPlayer.data = playerData;
      socket.emit('waiting');
    }
  });

  socket.on('disconnect', () => {
    if (waitingPlayer === socket) waitingPlayer = null;
    console.log('Joueur déconnecté :', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Serveur en écoute sur le port ${PORT}`);
});