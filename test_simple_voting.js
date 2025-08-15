const io = require('socket.io-client');

// Simple test with delay between votes
async function testSimpleVoting() {
  console.log('🐺 Simple Werewolf Voting Test...\n');

  const players = [];
  const playerNames = ['Wolf1', 'Wolf2', 'Villager1', 'Villager2'];
  
  try {
    // Connect players
    for (let i = 0; i < 4; i++) {
      const client = io('http://localhost:3000');
      players.push({
        name: playerNames[i],
        client: client,
        id: null,
        role: null
      });
      
      await new Promise(resolve => {
        client.on('connect', () => {
          players[i].id = client.id;
          console.log(`✅ ${playerNames[i]} connected`);
          resolve();
        });
      });
    }

    // Create and join lobby
    let lobbyId = null;
    await new Promise(resolve => {
      players[0].client.emit('create_lobby', players[0].name, (response) => {
        lobbyId = response.lobbyId;
        console.log(`🏠 Lobby created: ${lobbyId}`);
        resolve();
      });
    });

    for (let i = 1; i < players.length; i++) {
      await new Promise(resolve => {
        players[i].client.emit('join_lobby', { 
          lobbyId: lobbyId, 
          playerName: players[i].name 
        }, () => resolve());
      });
    }

    // Set ready and start game
    for (let player of players) {
      player.client.emit('player_ready', { lobbyId: lobbyId, ready: true });
    }

    await new Promise(resolve => setTimeout(resolve, 100));

    await new Promise(resolve => {
      players[0].client.emit('start_game', { lobbyId: lobbyId });
      
      let rolesReceived = 0;
      players.forEach((player, index) => {
        player.client.on('game_started', (data) => {
          player.role = data.role;
          console.log(`🎭 ${player.name} is a ${data.role}`);
          rolesReceived++;
          if (rolesReceived === players.length) {
            resolve();
          }
        });
      });
    });

    const werewolves = players.filter(p => p.role === 'Werwolf');
    const others = players.filter(p => p.role !== 'Werwolf');
    
    console.log(`\n🐺 Werewolves: ${werewolves.map(w => w.name).join(', ')}`);

    if (werewolves.length < 2) {
      console.log('❌ Need at least 2 werewolves for this test');
      return;
    }

    // Set up listeners
    let voteResults = [];
    werewolves.forEach(wolf => {
      wolf.client.on('wolf_vote_update', (data) => {
        console.log(`📊 ${wolf.name} sees: ${data.received}/${data.expected} votes`);
      });
      
      wolf.client.on('wolf_result', (result) => {
        console.log(`🎯 Voting completed! Target: ${result.targetId}`);
        voteResults.push(result);
      });
    });

    await new Promise(resolve => setTimeout(resolve, 1000));

    // Vote with delay between votes
    const target = others[0];
    console.log(`\n🗳️ ${werewolves[0].name} votes for ${target.name}`);
    werewolves[0].client.emit('wolf_action', { 
      lobbyId: lobbyId, 
      targetId: target.id 
    });

    await new Promise(resolve => setTimeout(resolve, 1000));

    console.log(`🗳️ ${werewolves[1].name} votes for ${target.name}`);
    werewolves[1].client.emit('wolf_action', { 
      lobbyId: lobbyId, 
      targetId: target.id 
    });

    await new Promise(resolve => setTimeout(resolve, 2000));

    if (voteResults.length > 0) {
      console.log('\n✅ Voting finalized successfully!');
    } else {
      console.log('\n❌ Voting did not finalize');
    }

  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    players.forEach(player => {
      if (player.client) {
        player.client.disconnect();
      }
    });
    process.exit(0);
  }
}

testSimpleVoting().catch(console.error);