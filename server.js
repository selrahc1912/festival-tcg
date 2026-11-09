// ============================================================
//  Festival TCG — serveur multijoueur 1 contre 1
//  Node.js + Socket.io (v4)
//
//  Rôle du serveur :
//   - matchmaking : associe deux vrais joueurs
//   - synchronise les manches : le coup d'un joueur n'est révélé à
//     l'adversaire qu'une fois que LES DEUX ont joué (révélation simultanée)
//   - gère les abandons / déconnexions / joueurs inactifs
//  Les mains et les pioches restent chez chaque joueur (informations cachées).
// ============================================================
const http = require("http");
const { Server } = require("socket.io");

const PORT = process.env.PORT || 3000;
const ROUNDS = 5;
const DECK_SIZE = 30;
// Délai max d'une manche (60 s côté client + marge)
const PLAY_TIMEOUT_MS = 75 * 1000;
// Délai max entre la fin d'une manche et le prêt pour la suivante
// (récap 15 s + échange 30 s côté client + marge)
const NEXT_TIMEOUT_MS = 75 * 1000;

const httpServer = http.createServer((req, res) => {
  // Petite page de contrôle (utile pour Render / pour réveiller le serveur)
  res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Festival TCG server OK");
});

const io = new Server(httpServer, {
  cors: { origin: "*" },
  pingInterval: 10000,
  pingTimeout: 15000,
});

/** @type {Array<{socket: any, pseudo: string, points: number, deck: string[]}>} */
let queue = [];
/** socket.id -> room */
const roomOf = new Map();
let roomCounter = 0;

// ---------- utilitaires ----------
function cleanPseudo(p) {
  const s = typeof p === "string" ? p.replace(/[\u0000-\u001f<>]/g, "").trim() : "";
  return s.slice(0, 20) || "Joueur";
}

function cleanDeck(d) {
  if (!Array.isArray(d) || d.length !== DECK_SIZE) return null;
  for (const id of d) {
    if (typeof id !== "string" || id.length === 0 || id.length > 80) return null;
  }
  return d.slice();
}

// Un coup est soit null (manche passée), soit { f: idFestival, a: [idsArtistes] }.
// On vérifie ici que les cartes jouées appartiennent bien au deck du joueur.
function cleanPlay(play, deckSet) {
  if (!play || typeof play !== "object") return null;
  if (typeof play.f !== "string" || !Array.isArray(play.a)) return null;
  if (play.a.length < 1 || play.a.length > 20) return null;
  const arts = [];
  for (const id of play.a) {
    if (typeof id !== "string" || arts.includes(id)) return null;
    arts.push(id);
  }
  if (!deckSet.has(play.f)) return null;
  if (!arts.every((id) => deckSet.has(id))) return null;
  return { f: play.f, a: arts };
}

function removeFromQueue(socket) {
  queue = queue.filter((q) => q.socket.id !== socket.id);
}

// ---------- gestion des parties ----------
function destroyRoom(room) {
  room.over = true;
  clearTimeout(room.timer);
  room.players.forEach((p) => roomOf.delete(p.socket.id));
}

function armTimer(room, ms, fn) {
  clearTimeout(room.timer);
  room.timer = setTimeout(() => {
    if (!room.over) fn();
  }, ms);
}

function startPlayPhase(room) {
  room.phase = "play";
  room.plays = [undefined, undefined]; // undefined = n'a pas encore joué
  armTimer(room, PLAY_TIMEOUT_MS, () => resolveRound(room));
}

function resolveRound(room) {
  if (room.over || room.phase !== "play") return;
  // Les joueurs absents ou trop lents passent leur manche
  const plays = room.plays.map((p) => (p === undefined ? null : p));
  const round = room.round;

  room.players.forEach((p, i) => {
    p.socket.emit("round_result", { round, opponent: plays[1 - i] });
  });

  if (round >= ROUNDS) {
    // Partie terminée : plus rien à synchroniser
    destroyRoom(room);
    return;
  }

  room.phase = "swap";
  room.swaps = new Set();
  armTimer(room, NEXT_TIMEOUT_MS, () => startNextRound(room));
}

function startNextRound(room) {
  if (room.over || room.phase !== "swap") return;
  room.round++;
  room.players.forEach((p) => p.socket.emit("next_round", { round: room.round }));
  startPlayPhase(room);
}

function playerLeft(socket, reason) {
  const room = roomOf.get(socket.id);
  if (!room || room.over) return;
  const other = room.players.find((p) => p.socket.id !== socket.id);
  destroyRoom(room);
  if (other) other.socket.emit("opponent_left", { reason });
}

function createRoom(a, b) {
  const room = {
    id: "room-" + ++roomCounter,
    players: [a, b],
    round: 1,
    phase: "play",
    plays: [undefined, undefined],
    swaps: new Set(),
    timer: null,
    over: false,
  };
  a.deckSet = new Set(a.deck);
  b.deckSet = new Set(b.deck);
  roomOf.set(a.socket.id, room);
  roomOf.set(b.socket.id, room);

  // Chaque joueur ne reçoit que le pseudo et les points de l'autre (pas son deck)
  a.socket.emit("match_found", {
    room: room.id,
    opponent: { pseudo: b.pseudo, points: b.points },
  });
  b.socket.emit("match_found", {
    room: room.id,
    opponent: { pseudo: a.pseudo, points: a.points },
  });
  startPlayPhase(room);
}

function tryMatch() {
  // Retire les sockets déconnectés
  queue = queue.filter((q) => q.socket.connected);
  while (queue.length >= 2) {
    const a = queue.shift();
    const b = queue.shift();
    createRoom(a, b);
  }
}

// ---------- événements Socket.io ----------
io.on("connection", (socket) => {
  socket.on("find_match", (data) => {
    if (roomOf.has(socket.id)) return; // déjà en partie
    removeFromQueue(socket); // jamais deux fois dans la file
    data = data || {};
    const deck = cleanDeck(data.deck);
    if (!deck) {
      socket.emit("error_msg", { message: `Deck invalide (il faut exactement ${DECK_SIZE} cartes).` });
      return;
    }
    const pts = Math.max(0, Math.min(1e6, parseInt(data.points, 10) || 0));
    queue.push({ socket, pseudo: cleanPseudo(data.pseudo), points: pts, deck });
    socket.emit("waiting");
    tryMatch();
  });

  socket.on("cancel_search", () => removeFromQueue(socket));

  // Un joueur envoie son coup pour la manche en cours
  socket.on("play_turn", (data) => {
    const room = roomOf.get(socket.id);
    if (!room || room.over || room.phase !== "play") return;
    if (!data || data.round !== room.round) return;
    const idx = room.players.findIndex((p) => p.socket.id === socket.id);
    if (idx < 0 || room.plays[idx] !== undefined) return; // déjà joué
    room.plays[idx] = cleanPlay(data.play, room.players[idx].deckSet);
    // Dès que les deux ont joué, on révèle les deux coups en même temps
    if (room.plays[0] !== undefined && room.plays[1] !== undefined) resolveRound(room);
  });

  // Un joueur a terminé son échange de cartes
  socket.on("swap_done", (data) => {
    const room = roomOf.get(socket.id);
    if (!room || room.over || room.phase !== "swap") return;
    if (!data || data.round !== room.round) return;
    room.swaps.add(socket.id);
    if (room.swaps.size >= 2) startNextRound(room);
  });

  socket.on("forfeit", () => playerLeft(socket, "L'adversaire a abandonné la partie."));

  socket.on("disconnect", () => {
    removeFromQueue(socket);
    playerLeft(socket, "L'adversaire s'est déconnecté.");
  });
});

httpServer.listen(PORT, () => {
  console.log(`Festival TCG server en écoute sur le port ${PORT}`);
});
