// server.js - DEBUG VERSION
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET','POST'] },
  maxHttpBufferSize: 10 * 1024 * 1024,
});

// In-memory room storage: roomId -> { participants: Set, host: socketId, createdAt: timestamp }
const rooms = new Map();

// Helper to cleanup empty rooms
function cleanupRoom(roomId) {
  const room = rooms.get(roomId);
  if (room && room.participants.size === 0) {
    rooms.delete(roomId);
    console.log(`🧹 Cleaned up empty room: ${roomId}`);
  }
}

// Helper to get or create room
function getOrCreateRoom(roomId) {
  if (!rooms.has(roomId)) {
    console.log(`🆕 Creating new room: ${roomId}`);
    rooms.set(roomId, {
      participants: new Set(),
      host: null,
      createdAt: Date.now()
    });
  }
  return rooms.get(roomId);
}

// Debug function to print all rooms
function printAllRooms() {
  console.log(`\n📊 === CURRENT ROOMS (${rooms.size} total) ===`);
  if (rooms.size === 0) {
    console.log(`📊 No rooms exist`);
  } else {
    for (const [roomId, room] of rooms.entries()) {
      console.log(`📊 Room ${roomId}:`);
      console.log(`   - Participants: ${room.participants.size}/2`);
      console.log(`   - IDs: [${Array.from(room.participants).join(', ')}]`);
      console.log(`   - Host: ${room.host}`);
      console.log(`   - Created: ${new Date(room.createdAt).toISOString()}`);
    }
  }
  console.log(`📊 ========================\n`);
}

io.on('connection', socket => {
  console.log(`\n✅ NEW CONNECTION: ${socket.id}`);
  printAllRooms();
  
  // Store current room for this socket
  let currentRoom = null;

  socket.on('join-room', roomId => {
    console.log(`\n🚪🚪🚪 JOIN ROOM REQUEST 🚪🚪🚪`);
    console.log(`Socket: ${socket.id}`);
    console.log(`Room: ${roomId}`);
    console.log(`Current room for this socket: ${currentRoom}`);
    
    const room = getOrCreateRoom(roomId);
    
    console.log(`🔍 BEFORE JOIN - Room ${roomId} state:`);
    console.log(`   - Size: ${room.participants.size}`);
    console.log(`   - Participants: [${Array.from(room.participants).join(', ')}]`);
    console.log(`   - Host: ${room.host}`);
    
    // Check if user is already in the room (reconnection case)
    if (room.participants.has(socket.id)) {
      console.log(`🔄 RECONNECTION: ${socket.id} is already in room ${roomId}`);
      currentRoom = roomId;
      socket.join(roomId);
      return;
    }

    // CRITICAL CHECK: Room size limit
    console.log(`\n🚨 CHECKING ROOM LIMIT 🚨`);
    console.log(`Current participants: ${room.participants.size}`);
    console.log(`Max allowed: 2`);
    console.log(`Check: ${room.participants.size} >= 2 = ${room.participants.size >= 2}`);
    
    if (room.participants.size >= 2) {
      console.log(`\n❌❌❌ ROOM FULL - REJECTING ❌❌❌`);
      console.log(`Room: ${roomId}`);
      console.log(`Current size: ${room.participants.size}/2`);
      console.log(`Existing participants: [${Array.from(room.participants).join(', ')}]`);
      console.log(`Rejecting: ${socket.id}`);
      console.log(`Sending 'room-full' event to ${socket.id}`);
      
      socket.emit('room-full');
      
      console.log(`❌ room-full event sent to ${socket.id}`);
      printAllRooms();
      return;
    }

    // Add user to room
    console.log(`\n✅ ADDING USER TO ROOM`);
    console.log(`Adding ${socket.id} to room ${roomId}`);
    
    room.participants.add(socket.id);
    currentRoom = roomId;
    socket.join(roomId);

    console.log(`✅ User added successfully`);
    console.log(`New size: ${room.participants.size}`);
    console.log(`New participants: [${Array.from(room.participants).join(', ')}]`);

    // Set first participant as host
    if (!room.host) {
      room.host = socket.id;
      console.log(`👑 ${socket.id} is now HOST of room ${roomId}`);
    }

    console.log(`\n🎉 JOIN SUCCESS:`);
    console.log(`   - Socket: ${socket.id}`);
    console.log(`   - Room: ${roomId}`);
    console.log(`   - Participants: ${room.participants.size}/2`);
    console.log(`   - IDs: [${Array.from(room.participants).join(', ')}]`);

    // If this is the second person, notify both participants
    if (room.participants.size === 2) {
      console.log(`\n🎉🎉🎉 ROOM NOW FULL - STARTING PEER CONNECTION 🎉🎉🎉`);
      console.log(`Sending 'peer-joined' to all in room ${roomId}`);
      io.to(roomId).emit('peer-joined');
    }

    // Send room status to all participants
    const statusData = {
      participantCount: room.participants.size,
      maxParticipants: 2,
      isFull: room.participants.size >= 2
    };
    console.log(`📊 Sending room-status:`, statusData);
    io.to(roomId).emit('room-status', statusData);
    
    printAllRooms();
  });

  socket.on('check-host', (roomId, callback) => {
    console.log(`\n👑 HOST CHECK: ${socket.id} for room ${roomId}`);
    
    if (!rooms.has(roomId)) {
      console.log(`❌ Room ${roomId} does not exist for host check`);
      if (callback) callback(false);
      return;
    }

    const room = rooms.get(roomId);
    const isHost = room.host === socket.id;
    console.log(`👑 Host status: ${isHost} (host is: ${room.host})`);
    
    if (callback) callback(isHost);
  });

  // WebRTC Signaling Events - Fixed format to match frontend expectations
  socket.on('offer', ({ offer, roomId }) => {
    console.log(`📤 OFFER: ${socket.id} -> room ${roomId}`, offer ? 'valid' : 'NULL/INVALID');
    if (offer && offer.type && offer.sdp) {
      socket.to(roomId).emit('offer', offer);  // Send just the offer, not wrapped
    } else {
      console.log(`❌ Invalid offer received:`, offer);
    }
  });

  socket.on('answer', ({ answer, roomId }) => {
    console.log(`📤 ANSWER: ${socket.id} -> room ${roomId}`, answer ? 'valid' : 'NULL/INVALID');
    if (answer && answer.type && answer.sdp) {
      socket.to(roomId).emit('answer', answer);  // Send just the answer, not wrapped
    } else {
      console.log(`❌ Invalid answer received:`, answer);
    }
  });

  socket.on('ice-candidate', ({ candidate, roomId }) => {
    console.log(`📤 ICE: ${socket.id} -> room ${roomId}`, candidate ? 'valid' : 'NULL/INVALID');
    if (candidate) {
      socket.to(roomId).emit('ice-candidate', candidate);  // Send just the candidate, not wrapped
    } else {
      console.log(`❌ Invalid ICE candidate received:`, candidate);
    }
  });

  // Name exchange
  socket.on('set-name', ({ roomId, name }) => {
    console.log(`👤 NAME: ${socket.id} set name "${name}" in room ${roomId}`);
    //socket.to(roomId).emit('peer-name', { name, senderId: socket.id });
    socket.to(roomId).emit('peer-name', { name, senderId: socket.id });
  });

  // Chat messages
  socket.on('chat-message', ({ roomId, sender, message, type, timestamp }) => {
    console.log(`💬 CHAT: ${socket.id} in room ${roomId}`);
    socket.to(roomId).emit('chat-message', {
      sender: sender || socket.id,
      message,
      type,
      timestamp: timestamp || Date.now(),
    });
  });


  // ── Screen-share signaling ───────────────────────────────────────────────
socket.on('screen-share-started', (roomId) => {
  console.log(`🔊 Screen share started by ${socket.id} in room ${roomId}`);
  socket.to(roomId).emit('screen-share-started');
});
socket.on('screen-share-stopped', (roomId) => {
  console.log(`🔊 Screen share stopped by ${socket.id} in room ${roomId}`);
  socket.to(roomId).emit('screen-share-stopped');
});


  // Handle meeting end
  socket.on('end-meeting', ({ roomId, endedBy }) => {
    console.log(`\n🔚 MEETING ENDED by ${endedBy} in room ${roomId}`);
    socket.to(roomId).emit('meeting-ended', { endedBy });
    
    if (rooms.has(roomId)) {
      rooms.delete(roomId);
      console.log(`🗑️ Room ${roomId} deleted after meeting end`);
    }
    printAllRooms();
  });

  // Manual leave
  socket.on('leave-room', roomId => {
    console.log(`\n🚪 MANUAL LEAVE: ${socket.id} from room ${roomId}`);
    
    if (!rooms.has(roomId)) {
      console.log(`❌ Room ${roomId} doesn't exist`);
      return;
    }
    
    const room = rooms.get(roomId);
    console.log(`Before leave - participants: [${Array.from(room.participants).join(', ')}]`);
    
    room.participants.delete(socket.id);
    socket.leave(roomId);
    
    console.log(`After leave - participants: [${Array.from(room.participants).join(', ')}]`);
    
    if (room.host === socket.id) {
      console.log(`👑 Host left room ${roomId}`);
      socket.to(roomId).emit('host-left');
      
      const remainingParticipants = Array.from(room.participants);
      if (remainingParticipants.length > 0) {
        room.host = remainingParticipants[0];
        console.log(`👑 New host: ${room.host}`);
      }
    } else {
      console.log(`👤 Peer left room ${roomId}`);
      socket.to(roomId).emit('peer-left');
    }

    cleanupRoom(roomId);
    currentRoom = null;

    if (rooms.has(roomId)) {
      const updatedRoom = rooms.get(roomId);
      const statusData = {
        participantCount: updatedRoom.participants.size,
        maxParticipants: 2,
        isFull: updatedRoom.participants.size >= 2
      };
      console.log(`📊 Updated room status:`, statusData);
      io.to(roomId).emit('room-status', statusData);
    }
    
    printAllRooms();
  });

  // Disconnect cleanup
  socket.on('disconnect', reason => {
    console.log(`\n❌ DISCONNECT: ${socket.id} (${reason})`);
    
    if (currentRoom && rooms.has(currentRoom)) {
      const room = rooms.get(currentRoom);
      
      console.log(`Before disconnect cleanup - Room ${currentRoom}:`);
      console.log(`   - Size: ${room.participants.size}`);
      console.log(`   - Participants: [${Array.from(room.participants).join(', ')}]`);
      
      room.participants.delete(socket.id);
      
      console.log(`After disconnect cleanup - Room ${currentRoom}:`);
      console.log(`   - Size: ${room.participants.size}`);
      console.log(`   - Participants: [${Array.from(room.participants).join(', ')}]`);

      if (room.host === socket.id && room.participants.size > 0) {
        console.log(`👑 Host disconnected, notifying room`);
        socket.to(currentRoom).emit('host-left');
        
        const remainingParticipants = Array.from(room.participants);
        if (remainingParticipants.length > 0) {
          room.host = remainingParticipants[0];
          console.log(`👑 New host: ${room.host}`);
        }
      } else {
        console.log(`👤 Peer disconnected, notifying room`);
        socket.to(currentRoom).emit('peer-left');
      }

      cleanupRoom(currentRoom);

      if (rooms.has(currentRoom)) {
        const updatedRoom = rooms.get(currentRoom);
        const statusData = {
          participantCount: updatedRoom.participants.size,
          maxParticipants: 2,
          isFull: updatedRoom.participants.size >= 2
        };
        console.log(`📊 Post-disconnect room status:`, statusData);
        io.to(currentRoom).emit('room-status', statusData);
      }
    }
    
    printAllRooms();
  });
});

// Enhanced health check
app.get('/health', (_, res) => {
  const roomDetails = {};
  for (const [roomId, room] of rooms.entries()) {
    roomDetails[roomId] = {
      participants: room.participants.size,
      participantIds: Array.from(room.participants),
      host: room.host,
      createdAt: new Date(room.createdAt).toISOString()
    };
  }
  
  res.json({ 
    status: 'OK', 
    totalRooms: rooms.size,
    rooms: roomDetails
  });
});

// Debug endpoint
app.get('/rooms/:roomId', (req, res) => {
  const roomId = req.params.roomId;
  const room = rooms.get(roomId);
  
  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }
  
  res.json({
    roomId,
    participantCount: room.participants.size,
    participants: Array.from(room.participants),
    host: room.host,
    createdAt: new Date(room.createdAt).toISOString(),
    isFull: room.participants.size >= 2
  });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`🚀 DEBUG SERVER listening on http://localhost:${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  console.log(`🔍 This is a DEBUG version with detailed logging`);
});

