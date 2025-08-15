const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// In-Memory Lobbys
const lobbies = {}; 
// Struktur: { lobbyId: { players: [ {id, name} ] } }

const gameState = {};

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
  console.log(`[STATE][DEBUG][${processId}] getState called for lobby ${lobbyId}`);
  console.log(`[STATE][DEBUG][${processId}] gameState keys before: [${Object.keys(gameState).join(',')}]`);
  console.log(`[STATE][DEBUG][${processId}] gameState[${lobbyId}] exists: ${!!gameState[lobbyId]}`);
  
  if (!gameState[lobbyId]) {
    console.log(`[STATE][${processId}] Creating new game state for lobby ${lobbyId}`);
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
  } else {
    console.log(`[STATE][DEBUG][${processId}] Using existing state for lobby ${lobbyId}`);
    console.log(`[STATE][DEBUG][${processId}] Existing wolfVotesByRound: ${JSON.stringify(gameState[lobbyId].wolfVotesByRound)}`);
  }
  
  // Only initialize if missing, never overwrite existing data
  if (!gameState[lobbyId].actions) {
    console.log(`[STATE][${processId}] Initializing missing actions for lobby ${lobbyId}`);
    gameState[lobbyId].actions = {};
  }
  if (!gameState[lobbyId].wolfVotes) {
    console.log(`[STATE][${processId}] Initializing missing wolfVotes for lobby ${lobbyId}`);
    gameState[lobbyId].wolfVotes = {};
  }
  if (!gameState[lobbyId].wolfVotesByRound) {
    console.log(`[STATE][${processId}] Initializing missing wolfVotesByRound for lobby ${lobbyId}`);
    gameState[lobbyId].wolfVotesByRound = {};
  }
  
  console.log(`[STATE][DEBUG][${processId}] Returning state with wolfVotesByRound: ${JSON.stringify(gameState[lobbyId].wolfVotesByRound)}`);
  return gameState[lobbyId];
}
function finishNight(lobbyId) {
  const { lobby, state } = getLobbyAndState(lobbyId);
  if (!lobby) return;
  if (state.nightResolved) return;   // <— Schutz
  state.nightResolved = true;
  
  // Process night deaths (wolf kill, poison, etc.)
  const deaths = [];
  
  // Wolf target (if not healed)
  if (state.actions.wolfTarget && !state.actions.healTarget) {
    const victim = lobby.players.find(p => p.id === state.actions.wolfTarget);
    if (victim && victim.alive) {
      victim.alive = false;
      deaths.push(victim.name);
    }
  }
  
  // Poison target
  if (state.actions.poisonTarget) {
    const victim = lobby.players.find(p => p.id === state.actions.poisonTarget);
    if (victim && victim.alive) {
      victim.alive = false;
      deaths.push(victim.name);
    }
  }
  
  // Handle lover deaths if one lover dies
  if (state.lovers && state.lovers.length === 2) {
    const lover1 = lobby.players.find(p => p.id === state.lovers[0]);
    const lover2 = lobby.players.find(p => p.id === state.lovers[1]);
    
    if (lover1 && lover2) {
      if (!lover1.alive && lover2.alive) {
        lover2.alive = false;
        deaths.push(`${lover2.name} (Liebeskummer)`);
      } else if (!lover2.alive && lover1.alive) {
        lover1.alive = false;
        deaths.push(`${lover1.name} (Liebeskummer)`);
      }
    }
  }
  
  // Announce deaths
  if (deaths.length > 0) {
    io.to(lobbyId).emit('night_deaths', deaths);
  } else {
    io.to(lobbyId).emit('night_deaths', ['Niemand ist gestorben.']);
  }

  // Reset für nächste Nacht/Tag
  state.actions = {};
  state.wolfVotes = {};
  if (state.wolfTimer) { clearTimeout(state.wolfTimer); state.wolfTimer = null; }

  emitPlayerList(lobbyId);
  
  // Start day phase
  startDayPhase(lobbyId);
}

function getLobbyAndState(lobbyId) {
  const lobby = lobbies[lobbyId];
  if (!lobby) return { lobby: null, state: null };
  
  // Store state directly in the lobby object for better persistence
  if (!lobby.gameState) {
    lobby.gameState = {
      phase: 'Nacht',
      lovers: [],
      actions: {},
      usedPotion: { heal: false, poison: false },
      wolfVotes: {},
      wolfVotesByRound: {},
      wolfTimer: null,
      nightResolved: false,
      nightRound: 0,
      dayVotes: {},
      dayVotingActive: false,
    };
  }
  
  // Also sync to global gameState for backward compatibility
  gameState[lobbyId] = lobby.gameState;
  
  return { lobby, state: lobby.gameState };
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

function startDayPhase(lobbyId) {
  const { lobby, state } = getLobbyAndState(lobbyId);
  if (!lobby) return;
  
  state.phase = 'Tag';
  state.dayVotes = {};
  state.dayVotingActive = true;
  
  console.log(`[DAY][start] lobby=${lobbyId} starting day phase`);
  
  io.to(lobbyId).emit('phase_update', 'Tag');
  
  // Get all living players who can vote
  const livingPlayers = lobby.players.filter(p => p.alive);
  
  if (livingPlayers.length <= 2) {
    // Game should end if too few players
    io.to(lobbyId).emit('game_end', 'Spiel beendet - zu wenige Spieler übrig');
    return;
  }
  
  // Send voting options to all living players
  const votingOptions = livingPlayers.map(p => ({ id: p.id, name: p.name }));
  
  livingPlayers.forEach(player => {
    io.to(player.id).emit('day_vote_start', {
      players: votingOptions,
      canVote: true
    });
  });
  
  // Also inform dead players (they can observe but not vote)
  const deadPlayers = lobby.players.filter(p => !p.alive);
  deadPlayers.forEach(player => {
    io.to(player.id).emit('day_vote_start', {
      players: votingOptions,
      canVote: false
    });
  });
  
  console.log(`[DAY] Voting started with ${livingPlayers.length} living players`);
}

function finalizeDayVotes(lobbyId) {
  const { lobby, state } = getLobbyAndState(lobbyId);
  if (!lobby) return;
  
  const livingPlayers = lobby.players.filter(p => p.alive);
  const expected = livingPlayers.length;
  const received = Object.keys(state.dayVotes).length;
  
  console.log(`[DAY][finalize] lobby=${lobbyId} expected=${expected} received=${received} votes=${JSON.stringify(state.dayVotes)}`);
  
  if (received < expected) {
    console.log('[DAY][finalize] noch nicht vollständig – Abbruch');
    return;
  }
  
  // Count votes
  const voteCounts = {};
  Object.values(state.dayVotes).forEach(targetId => {
    if (targetId) {  // null votes are abstentions
      voteCounts[targetId] = (voteCounts[targetId] || 0) + 1;
    }
  });
  
  console.log(`[DAY][finalize] vote counts=${JSON.stringify(voteCounts)}`);
  
  // Find player(s) with most votes
  let maxVotes = 0;
  let topCandidates = [];
  
  Object.entries(voteCounts).forEach(([playerId, count]) => {
    if (count > maxVotes) {
      maxVotes = count;
      topCandidates = [playerId];
    } else if (count === maxVotes) {
      topCandidates.push(playerId);
    }
  });
  
  let lynchTarget = null;
  let resultMessage = '';
  
  // Handle tie or no votes
  if (maxVotes === 0) {
    resultMessage = 'Niemand wurde gelyncht - keine Stimmen abgegeben.';
  } else if (topCandidates.length > 1) {
    // Tie - no lynch according to rule
    resultMessage = 'Unentschieden - niemand wird gelyncht.';
  } else {
    // Clear winner
    lynchTarget = topCandidates[0];
    const victim = lobby.players.find(p => p.id === lynchTarget);
    if (victim) {
      victim.alive = false;
      resultMessage = `${victim.name} wurde gelyncht.`;
    }
  }
  
  state.dayVotingActive = false;
  
  // Send results to all players
  io.to(lobbyId).emit('day_vote_result', {
    result: resultMessage,
    lynchTarget: lynchTarget,
    votes: voteCounts
  });
  
  emitPlayerList(lobbyId);
  
  console.log(`[DAY][finalize] result: ${resultMessage}`);
  
  // TODO: Add win condition checks here
  
  // Start next night after a delay
  setTimeout(() => {
    startFirstNight(lobbyId);
  }, 3000);
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
  const { state } = getLobbyAndState(lobbyId);
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

  // Ensure vote tracking structure exists
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
  const updateData = { expected, received };
  wolves.forEach(w => {
    io.to(w.id).emit('wolf_vote_update', updateData);
  });

  console.log(`[WOLF] lobby=${lobbyId} round=${roundKey} votes=${received}/${expected} targets=${JSON.stringify(filteredVotes)}`);

  // Finalize when all votes are in
  if (received === expected && received > 0) {
    finalizeWolfVotes(lobbyId);
  }
});





// Hexe
socket.on('witch_heal', ({ lobbyId }) => {
  const { state } = getLobbyAndState(lobbyId);
  if (!state) return;
  if (state.usedPotion.heal) return;
  state.actions.healTarget = state.actions.wolfTarget; // Mark as healed
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

// Day phase voting
socket.on('day_vote', ({ lobbyId, targetId }) => {
  const { lobby, state } = getLobbyAndState(lobbyId);
  if (!lobby) return;
  if (state.phase !== 'Tag' || !state.dayVotingActive) return;
  
  const voter = lobby.players.find(p => p.id === socket.id);
  if (!voter || !voter.alive) {
    return socket.emit('error_message', 'Nur lebende Spieler dürfen abstimmen.');
  }
  
  // Validate target (must be alive or null for abstention)
  if (targetId && !lobby.players.some(p => p.id === targetId && p.alive)) {
    return socket.emit('error_message', 'Ungültiges Ziel - Spieler muss am Leben sein.');
  }
  
  // Record or remove vote
  if (targetId) {
    state.dayVotes[socket.id] = targetId;
  } else {
    // Allow abstention by setting to null
    state.dayVotes[socket.id] = null;
  }
  
  const livingPlayers = lobby.players.filter(p => p.alive);
  const received = Object.keys(state.dayVotes).length;
  const expected = livingPlayers.length;
  
  // Send real-time updates to all living players
  const updateData = { expected, received };
  livingPlayers.forEach(player => {
    io.to(player.id).emit('day_vote_update', updateData);
  });
  
  console.log(`[DAY] lobby=${lobbyId} votes=${received}/${expected} votes=${JSON.stringify(state.dayVotes)}`);
  
  // Finalize when all votes are in
  if (received === expected && received > 0) {
    finalizeDayVotes(lobbyId);
  }
});


function generateRoles(playerCount) {
  const roles = [];

  // Always include core roles for balanced gameplay
  roles.push('Werwolf');
  if (playerCount >= 3) roles.push('Werwolf');
  if (playerCount >= 4) roles.push('Seher');
  if (playerCount >= 5) roles.push('Hexe');
  if (playerCount >= 6) roles.push('Armor');
  if (playerCount >= 7) roles.push('Werwolf');

  // Fill rest with villagers
  while (roles.length < playerCount) {
    roles.push('Dorfbewohner');
  }

  return roles;
}

  socket.on('disconnect', () => {
    console.log('Spieler getrennt:', socket.id);
    // Remove player from all lobbies and mark as not alive
    for (const lobbyId in lobbies) {
      const lobby = lobbies[lobbyId];
      const playerIndex = lobby.players.findIndex(p => p.id === socket.id);
      if (playerIndex !== -1) {
        const player = lobby.players[playerIndex];
        console.log(`Player ${player.name} (${socket.id}) disconnected from lobby ${lobbyId}`);
        
        // Mark player as not alive instead of removing to maintain game state
        player.alive = false;
        
        // If this was during wolf voting, recalculate votes
        const { state } = getLobbyAndState(lobbyId);
        if (state && state.phase === 'Nacht' && player.role === 'Werwolf') {
          console.log(`Werewolf ${player.name} disconnected during voting, recalculating votes...`);
          
          // Remove their vote if any
          const roundKey = String(state.nightRound ?? 1);
          if (state.wolfVotesByRound && state.wolfVotesByRound[roundKey]) {
            delete state.wolfVotesByRound[roundKey][socket.id];
          }
          
          // Recalculate and update remaining werewolves
          const wolves = lobby.players.filter(p => p.role === 'Werwolf' && p.alive);
          if (wolves.length > 0) {
            const wolfIds = new Set(wolves.map(w => w.id));
            const roundVotes = state.wolfVotesByRound[roundKey] || {};
            const filteredVotes = Object.fromEntries(
              Object.entries(roundVotes).filter(([id, _]) => wolfIds.has(id))
            );
            const received = Object.keys(filteredVotes).length;
            const expected = wolves.length;
            
            // Send updated counts to remaining werewolves
            const updateData = { expected, received };
            wolves.forEach(w => {
              io.to(w.id).emit('wolf_vote_update', updateData);
            });
            
            console.log(`[WOLF] Updated vote count after disconnect: ${received}/${expected}`);
            
            // Check if voting can now complete
            if (received === expected && received > 0) {
              finalizeWolfVotes(lobbyId);
            }
          }
        }
        
        io.to(lobbyId).emit('lobby_update', lobby.players);
      }
    }
  });
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`Server läuft auf http://localhost:${PORT}`);
});
