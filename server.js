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

  socket.on('find_match', (data) => {
    socket.playerData = data; // Stocke temporairement le deck et le pseudo du joueur

    if (waitingPlayer) {
      const room = 'room_' + socket.id;
      socket.join(room);
      waitingPlayer.join(room);

      // On envoie les données croisées des deux joueurs
      io.to(room).emit('match_found', {
        room: room,
        players: [
          { id: waitingPlayer.id, data: waitingPlayer.playerData },
          { id: socket.id, data: socket.playerData }
        ]
      });

      waitingPlayer = null;
    } else {
      waitingPlayer = socket;
      socket.emit('waiting');
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Serveur en écoute sur le port ${PORT}`);
});
