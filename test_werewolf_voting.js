const io = require('socket.io-client');

// Test script for werewolf voting functionality
async function testWerewolfVoting() {
  console.log('🐺 Testing Werewolf Voting System...\n');

  // Create multiple clients
  const players = [];
  const playerNames = ['Alice', 'Bob', 'Charlie', 'Diana'];
  
  try {
    // Connect players
    for (let i = 0; i < 4; i++) {
      const client = io('http://localhost:3000');
      players.push({
        name: playerNames[i],
        client: client,
        id: null,
        role: null,
        ready: false
      });
      
      // Wait for connection
      await new Promise(resolve => {
        client.on('connect', () => {
          players[i].id = client.id;
          console.log(`✅ ${playerNames[i]} connected: ${client.id}`);
          resolve();
        });
      });
    }

    // Create lobby with first player
    let lobbyId = null;
    await new Promise(resolve => {
      players[0].client.emit('create_lobby', players[0].name, (response) => {
        lobbyId = response.lobbyId;
        console.log(`🏠 Lobby created: ${lobbyId}`);
        resolve();
      });
    });

    // Join other players
    for (let i = 1; i < players.length; i++) {
      await new Promise(resolve => {
        players[i].client.emit('join_lobby', { 
          lobbyId: lobbyId, 
          playerName: players[i].name 
        }, (response) => {
          console.log(`👥 ${players[i].name} joined lobby`);
          resolve();
        });
      });
    }

    // Set all players ready
    for (let player of players) {
      player.client.emit('player_ready', { lobbyId: lobbyId, ready: true });
      console.log(`✋ ${player.name} is ready`);
    }

    // Wait a bit for updates
    await new Promise(resolve => setTimeout(resolve, 100));

    // Start game
    await new Promise(resolve => {
      players[0].client.emit('start_game', { lobbyId: lobbyId });
      console.log('🎮 Game started!');
      
      // Listen for game_started events to get roles
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

    // Find werewolves
    const werewolves = players.filter(p => p.role === 'Werwolf');
    const nonWerewolves = players.filter(p => p.role !== 'Werwolf');
    
    console.log(`\n🐺 Werewolves: ${werewolves.map(w => w.name).join(', ')}`);
    console.log(`👥 Others: ${nonWerewolves.map(n => `${n.name} (${n.role})`).join(', ')}\n`);

    if (werewolves.length === 0) {
      console.log('❌ No werewolves found in game - test cannot proceed');
      return;
    }

    // Test werewolf voting
    console.log('🗳️ Testing werewolf voting...\n');

    // Set up vote update listeners
    werewolves.forEach(wolf => {
      wolf.client.on('wolf_vote_update', (data) => {
        console.log(`📊 Vote update received by ${wolf.name}: ${data.received}/${data.expected} votes`);
      });
      
      wolf.client.on('wolf_turn', (choices) => {
        console.log(`🎯 ${wolf.name} received voting choices: ${choices.length} options`);
      });
      
      wolf.client.on('wolf_message', (message) => {
        console.log(`💬 Message to ${wolf.name}: ${message}`);
      });
      
      wolf.client.on('wolf_result', (result) => {
        console.log(`🎯 Voting result for ${wolf.name}: target=${result.targetId}, tie=${result.tie}`);
      });
    });

    // Wait for wolf turn to start
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Test: First werewolf votes for a non-werewolf
    if (nonWerewolves.length > 0) {
      const target = nonWerewolves[0];
      console.log(`🗳️ ${werewolves[0].name} votes for ${target.name}`);
      werewolves[0].client.emit('wolf_action', { 
        lobbyId: lobbyId, 
        targetId: target.id 
      });
    }

    await new Promise(resolve => setTimeout(resolve, 500));

    // Test: Second werewolf votes for same target (if exists)
    if (werewolves.length > 1 && nonWerewolves.length > 0) {
      const target = nonWerewolves[0];
      console.log(`🗳️ ${werewolves[1].name} votes for ${target.name}`);
      werewolves[1].client.emit('wolf_action', { 
        lobbyId: lobbyId, 
        targetId: target.id 
      });
    }

    await new Promise(resolve => setTimeout(resolve, 500));

    // Test: Try voting with non-werewolf (should fail)
    if (nonWerewolves.length > 0) {
      console.log(`❌ Testing invalid vote from ${nonWerewolves[0].name} (not a werewolf)`);
      nonWerewolves[0].client.on('error_message', (message) => {
        console.log(`✅ Expected error received: ${message}`);
      });
      nonWerewolves[0].client.emit('wolf_action', { 
        lobbyId: lobbyId, 
        targetId: players[0].id 
      });
    }

    await new Promise(resolve => setTimeout(resolve, 1000));

    console.log('\n✅ Werewolf voting test completed!');

  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    // Clean up connections
    players.forEach(player => {
      if (player.client) {
        player.client.disconnect();
      }
    });
    process.exit(0);
  }
}

// Run the test
testWerewolfVoting().catch(console.error);