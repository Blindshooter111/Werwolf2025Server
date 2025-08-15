const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// In-Memory Lobbys
const lobbies = {}; 
// Struktur: { lobbyId: { players: [ {id, name} ] } }

io.on('connection', (socket) => {
  console.log('Ein Spieler verbunden:', socket.id);

socket.on('create_lobby', (playerName, callback) => {
  const lobbyId = Math.floor(1000 + Math.random() * 9000).toString(); // 4-stellig
  lobbies[lobbyId] = { players: [] };
lobbies[lobbyId].players.push({ id: socket.id, name: playerName, ready: false, alive: true });
socket.join(lobbyId);
io.to(lobbyId).emit('lobby_update', lobbies[lobbyId].players);
  console.log(`Lobby ${lobbyId} erstellt von ${playerName}`);
  callback({ lobbyId, players: lobbies[lobbyId].players });
});

socket.on('join_lobby', ({ lobbyId, playerName }, callback) => {
  const lobby = lobbies[lobbyId];
  if (!lobby) {
    callback({ error: 'Lobby existiert nicht' });
    return;
  }
  lobby.players.push({ id: socket.id, name: playerName, ready: false, alive: true });
  socket.join(lobbyId);
  console.log(`${playerName} ist Lobby ${lobbyId} beigetreten`);
  io.to(lobbyId).emit('lobby_update', lobby.players);
  callback({ lobbyId, players: lobby.players });
});

// 🆕 Ready-Event
socket.on('player_ready', ({ lobbyId, ready }) => {
  const lobby = lobbies[lobbyId];
  if (!lobby) return;

  const player = lobby.players.find(p => p.id === socket.id);
  if (player) {
    player.ready = ready;
    console.log(`${player.name} ist jetzt ${ready ? 'bereit' : 'nicht bereit'}`);
    io.to(lobbyId).emit('lobby_update', lobby.players);
  }
});

const gameState = {};

function getState(lobbyId) {
  if (!gameState[lobbyId]) {
    gameState[lobbyId] = {
      phase: 'Nacht',
      lovers: [],
      actions: {},
      usedPotion: { heal: false, poison: false },
      wolfVotes: {},
      wolfVotesByRound: {},
      wolfTimer: null,
      nightResolved: false,
    };
  }
  if (!gameState[lobbyId].actions) gameState[lobbyId].actions = {};
  if (!gameState[lobbyId].wolfVotes) gameState[lobbyId].wolfVotes = {};
  if (!gameState[lobbyId].wolfVotesByRound) gameState[lobbyId].wolfVotesByRound = {};
  
  return gameState[lobbyId];
}
function finishNight(lobbyId) {
  const { lobby, state } = getLobbyAndState(lobbyId);
  if (!lobby) return;
  if (state.nightResolved) return;   // <— Schutz
  state.nightResolved = true;
  // ... dein existierender Code (deaths, lovers, unique, remove, emits) ...

  // Reset für nächste Nacht/Tag
  state.actions = {};
  state.wolfVotes = {};
  if (state.wolfTimer) { clearTimeout(state.wolfTimer); state.wolfTimer = null; }

  state.phase = 'Tag';
  io.to(lobbyId).emit('phase_update', 'Tag');
  emitPlayerList(lobbyId);
}

function getLobbyAndState(lobbyId) {
  const lobby = lobbies[lobbyId];
  if (!lobby) return { lobby: null, state: null };
  
  // Always use the global gameState as the single source of truth
  const state = getState(lobbyId);
  lobby.state = state; // Always sync
  
  return { lobby, state };
}




function emitPlayerList(lobbyId) {
  const lobby = lobbies[lobbyId];
  if (!lobby) return;
  io.to(lobbyId).emit(
    'player_list',
    lobby.players.map(p => ({ id: p.id, name: p.name }))
  );
}

function startSeerPhase(lobbyId) {
  const { lobby, state } = getLobbyAndState(lobbyId);
  if (!lobby) return;
  state.phase = 'Nacht';
  const seer = lobby.players.find(p => p.role === 'Seher' && p.alive);
  if (seer) {
    io.to(seer.id).emit('seer_turn',
      lobby.players.filter(p => p.alive).map(p => ({ id: p.id, name: p.name }))
    );
  } else {
    startWolfPhase(lobbyId);
  }
}

function startWolfPhase(lobbyId) {
  const { lobby, state } = getLobbyAndState(lobbyId);
  if (!lobby) return;

  const startingNewNight = state.phase !== 'Nacht';
  state.phase = 'Nacht';
  console.log(`[WOLF][start] pid=${process.pid} round=${state.nightRound ?? 1} reset=${startingNewNight}`);

if (startingNewNight) {
  state.nightRound = (state.nightRound ?? 0) + 1;
  state.wolfVotes = {}; // legacy
  state.wolfVotesByRound = state.wolfVotesByRound || {};
  const k = String(state.nightRound);

  if (!state.wolfVotesByRound[k]) {
    state.wolfVotesByRound[k] = {};
  }

  state.actions.wolfTarget = null;
  state.nightResolved = false; // sicherheitshalber
}


  state.phase = 'Nacht';

  if (state.wolfTimer) { clearTimeout(state.wolfTimer); state.wolfTimer = null; }

  console.log(`[WOLF][start] lobby=${lobbyId} nightRound=${state.nightRound ?? 1} resetVotes=${startingNewNight}`);

  const wolves = lobby.players.filter(p => p.role === 'Werwolf' && p.alive);
  if (wolves.length === 0) return startWitchPhase(lobbyId);

  wolves.forEach(wolf => io.to(wolf.id).emit('wolf_vote_end'));

  const choices = lobby.players.filter(p => p.alive).map(p => ({ id: p.id, name: p.name }));
  wolves.forEach(wolf => io.to(wolf.id).emit('wolf_turn', choices));

  wolves.forEach(wolf =>
    io.to(wolf.id).emit('wolf_vote_update', { expected: wolves.length, received: 0 })
  );
}



function finalizeWolfVotes(lobbyId) {
  const { lobby, state } = getLobbyAndState(lobbyId);
  if (!lobby) return;

  state.nightRound = state.nightRound ?? 1;
  const roundKey = String(state.nightRound);
  const roundVotes = (state.wolfVotesByRound && state.wolfVotesByRound[roundKey]) || {};

  const wolves = lobby.players.filter(p => p.role === 'Werwolf' && p.alive);
  const wolvesIds = new Set(wolves.map(w => w.id));
  const expected = wolves.length;

  const filteredVotes = Object.fromEntries(
    Object.entries(roundVotes).filter(([id, _]) => wolvesIds.has(id))
  );
  const received = Object.keys(filteredVotes).length;

  console.log(`[WOLF][finalize] lobby=${lobbyId} round=${roundKey} expected=${expected} received=${received} votes=${JSON.stringify(filteredVotes)}`);

  if (received < expected) {
    console.log('[WOLF][finalize] noch nicht vollständig – Abbruch');
    return;
  }

  const targets = Object.values(filteredVotes);
  const first = targets[0];
  const unanimity = targets.every(t => t === first);
  console.log(`[WOLF][finalize] unanimity=${unanimity} target=${first}`);

  if (!unanimity) {
    wolves.forEach(wolf => io.to(wolf.id).emit('wolf_message', 'Wählt einheitlich!'));
    return;
  }

  // eindeutiges Opfer
  const topTarget = first;

  wolves.forEach(wolf => io.to(wolf.id).emit('wolf_result', { targetId: topTarget, tie: false }));
  wolves.forEach(wolf => io.to(wolf.id).emit('wolf_vote_end'));

  state.actions.wolfTarget = topTarget;

  console.log(`[WOLF][finalize] victim=${topTarget} → Hexenphase`);
  startWitchPhase(lobbyId);
}





function startWitchPhase(lobbyId) {
  const { lobby, state } = getLobbyAndState(lobbyId);
  if (!lobby) return;
  state.phase = 'Nacht';
  const witch = lobby.players.find(p => p.role === 'Hexe' && p.alive);
  if (!witch) {
    finishNight(lobbyId);
    return;
  }
  const victimId = state.actions.wolfTarget || null;
  const victim = lobby.players.find(p => p.id === victimId);
  io.to(witch.id).emit('witch_turn', {
    victim: victim ? victim.name : null,
    canHeal: !state.usedPotion.heal && !!victim,   // heilen nur sinnvoll wenn Opfer da
    canPoison: !state.usedPotion.poison,
    players: lobby.players.filter(p => p.alive).map(p => ({ id: p.id, name: p.name })),
  });
}



function startFirstNight(lobbyId) {
  const { lobby, state } = getLobbyAndState(lobbyId);
  if (!lobby) return;
  state.nightResolved = false; // <— reset
  state.phase = 'Nacht';
  io.to(lobbyId).emit('phase_update', 'Nacht');

  const armor = lobby.players.find(p => p.role === 'Armor' && p.alive);
  if (armor) {
    io.to(armor.id).emit('choose_lovers',
      lobby.players.filter(p => p.alive).map(p => ({ id: p.id, name: p.name }))
    );
  } else {
    startSeerPhase(lobbyId);
  }
}


socket.on('start_game', ({ lobbyId }) => {
  const lobby = lobbies[lobbyId];
  if (!lobby) return;

  if (lobby.players.length < 4) {
    io.to(socket.id).emit('error_message', 'Mindestens 4 Spieler benötigt.');
    return;
  }

  const allReady = lobby.players.every(p => p.ready === true);
  if (!allReady) {
    io.to(socket.id).emit('error_message', 'Nicht alle Spieler sind bereit.');
    return;
  }

  // Rollen generieren & mischen
  const roles = generateRoles(lobby.players.length);
  for (let i = roles.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [roles[i], roles[j]] = [roles[j], roles[i]];
  }

  // Zuweisen + individuelles game_started an jeden
  lobby.players.forEach((player, index) => {
    player.role = roles[index];
    player.alive = true; // Initialize all players as alive
    io.to(player.id).emit('game_started', { role: roles[index], lobbyId });
  });

  // Spielzustand robust anlegen + Phase/Nacht broadcasten + Playerliste senden
  const state = getState(lobbyId);
  state.phase = 'Nacht';
  io.to(lobbyId).emit('phase_update', 'Nacht');
  emitPlayerList(lobbyId);

  // Erste Nacht starten (Armor → Seher → Wölfe → Hexe → Ende)
  startFirstNight(lobbyId);
});



// Armor wählt Liebende
socket.on('set_lovers', ({ lobbyId, lover1, lover2 }) => {
  const { lobby, state } = getLobbyAndState(lobbyId);
  if (!lobby) return;
  state.lovers = [lover1, lover2];
  io.to(lobbyId).emit('lovers_set', state.lovers);
  startSeerPhase(lobbyId);
});

// Seher
socket.on('seer_action', ({ lobbyId, targetId }) => {
  const { lobby, state } = getLobbyAndState(lobbyId);
  if (!lobby) return;
  if (state.phase !== 'Nacht') return;
  const target = lobby.players.find(p => p.id === targetId);
  if (target) socket.emit('seer_result', { name: target.name, role: target.role });
  startWolfPhase(lobbyId);
});

socket.on('wolf_action', ({ lobbyId, targetId }) => {
  const { lobby, state } = getLobbyAndState(lobbyId);
  if (!lobby) return;
  if (state.phase !== 'Nacht') return;

  state.nightRound = state.nightRound ?? 1;

  const wolves = lobby.players.filter(p => p.role === 'Werwolf' && p.alive);
  const wolfIds = new Set(wolves.map(w => w.id));
  if (!wolfIds.has(socket.id)) {
    return socket.emit('error_message', 'Nur lebende Werwölfe dürfen abstimmen.');
  }

  if (targetId && !lobby.players.some(p => p.id === targetId && p.alive)) {
    return socket.emit('error_message', 'Ungültiges Ziel - Spieler muss am Leben sein.');
  }

  // Ensure the vote tracking structure exists
  state.wolfVotesByRound = state.wolfVotesByRound || {};
  const roundKey = String(state.nightRound);
  if (!state.wolfVotesByRound[roundKey]) {
    state.wolfVotesByRound[roundKey] = {};
  }

  // Record or remove vote
  if (targetId) {
    state.wolfVotesByRound[roundKey][socket.id] = targetId;
  } else {
    delete state.wolfVotesByRound[roundKey][socket.id];
  }

  // Count votes from living werewolves only
  const roundVotes = state.wolfVotesByRound[roundKey];
  const filteredVotes = Object.fromEntries(
    Object.entries(roundVotes).filter(([id, _]) => wolfIds.has(id))
  );
  const received = Object.keys(filteredVotes).length;
  const expected = wolves.length;

  // Send real-time updates to all werewolves
  wolves.forEach(w => io.to(w.id).emit('wolf_vote_update', { expected, received }));

  console.log(`[WOLF] lobby=${lobbyId} round=${roundKey} votes=${received}/${expected} targets=${JSON.stringify(filteredVotes)}`);

  // Finalize when all votes are in
  if (received === expected) {
    finalizeWolfVotes(lobbyId);
  }
});





// Hexe
socket.on('witch_heal', ({ lobbyId }) => {
  const { state } = getLobbyAndState(lobbyId);
  if (!state) return;
  if (state.usedPotion.heal) return;
  state.actions.wolfTarget = null; // Opfer gerettet
  state.usedPotion.heal = true;
});

socket.on('witch_poison', ({ lobbyId, targetId }) => {
  const { state } = getLobbyAndState(lobbyId);
  if (!state) return;
  if (state.usedPotion.poison) return;
  state.actions.poisonTarget = targetId || null;
  state.usedPotion.poison = true;
});

socket.on('witch_done', ({ lobbyId }) => {
  finishNight(lobbyId);
});


function generateRoles(playerCount) {
  const roles = [];

  // Immer mindestens diese Spezialrollen
  roles.push('Werwolf');
  if (playerCount >= 3) roles.push('Werwolf');
  if (playerCount >= 4) roles.push('Hexe');
  if (playerCount >= 5) roles.push('Armor');
  if (playerCount >= 6) roles.push('Werwolf');

  // Rest mit Dorfbewohnern auffüllen
  while (roles.length < playerCount) {
    roles.push('Dorfbewohner');
  }

  return roles;
}

  socket.on('disconnect', () => {
    console.log('Spieler getrennt:', socket.id);
    // Spieler aus allen Lobbys entfernen
    for (const lobbyId in lobbies) {
      const lobby = lobbies[lobbyId];
      lobby.players = lobby.players.filter(p => p.id !== socket.id);
      io.to(lobbyId).emit('lobby_update', lobby.players);
    }
  });
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`Server läuft auf http://localhost:${PORT}`);
});
