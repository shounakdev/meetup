// server.js - Production Version
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

// In-memory room storage: roomId -> { participants: Set, host: socketId, createdAt: timestamp, roomName: string }
const rooms = new Map();

// Helper to cleanup empty rooms
function cleanupRoom(roomId) {
  const room = rooms.get(roomId);
  if (room && room.participants.size === 0) {
    rooms.delete(roomId);
  }
}

// Helper to get or create room
function getOrCreateRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      participants: new Set(),
      host: null,
      createdAt: Date.now(),
      roomName: ''
    });
  }
  return rooms.get(roomId);
}

io.on('connection', socket => {
  let currentRoom = null;

  // Background sync between participants
  socket.on('background-sync', ({ roomId, backgroundUrl }) => {
    socket.to(roomId).emit('background-sync', { backgroundUrl });
  });

  socket.on('join-room', roomId => {
    const room = getOrCreateRoom(roomId);
    
    // Check if user is already in the room (reconnection case)
    if (room.participants.has(socket.id)) {
      currentRoom = roomId;
      socket.join(roomId);
      
      if (room.roomName) {
        socket.emit('room-name', { roomName: room.roomName });
      }
      return;
    }

    // Room size limit check
    if (room.participants.size >= 2) {
      socket.emit('room-full');
      return;
    }

    // Add user to room
    room.participants.add(socket.id);
    currentRoom = roomId;
    socket.join(roomId);

    // Set first participant as host
    if (!room.host) {
      room.host = socket.id;
    }

    // Send existing room name to new joiner if it exists
    if (room.roomName) {
      socket.emit('room-name', { roomName: room.roomName });
    }

    // If this is the second person, notify both participants
    if (room.participants.size === 2) {
      io.to(roomId).emit('peer-joined');
    }

    // Send room status to all participants
    const statusData = {
      participantCount: room.participants.size,
      maxParticipants: 2,
      isFull: room.participants.size >= 2
    };
    io.to(roomId).emit('room-status', statusData);
  });

  socket.on('check-host', (roomId, callback) => {
    if (!rooms.has(roomId)) {
      if (callback) callback(false);
      return;
    }

    const room = rooms.get(roomId);
    const isHost = room.host === socket.id;
    
    if (callback) callback(isHost);
  });

  // WebRTC Signaling Events
  socket.on('offer', ({ offer, roomId, isScreenShare }) => {
    if (offer && offer.type && offer.sdp) {
      socket.to(roomId).emit('offer', { ...offer, isScreenShare });
    }
  });

  socket.on('answer', ({ answer, roomId }) => {
    if (answer && answer.type && answer.sdp) {
      socket.to(roomId).emit('answer', answer);
    }
  });

  socket.on('ice-candidate', ({ candidate, roomId }) => {
    if (candidate) {
      socket.to(roomId).emit('ice-candidate', candidate);
    }
  });

  // Name exchange
  socket.on('set-name', ({ roomId, name }) => {
    socket.to(roomId).emit('peer-name', { name, senderId: socket.id });
  });

  // Chat messages
  socket.on('chat-message', ({ roomId, sender, message, type, timestamp }) => {
    socket.to(roomId).emit('chat-message', {
      sender: sender || socket.id,
      message,
      type,
      timestamp: timestamp || Date.now(),
    });
  });

  // Room name handling
  socket.on('room-name', ({ roomId, roomName }) => {
    if (!rooms.has(roomId)) {
      return;
    }
    
    const room = rooms.get(roomId);
    
    // Only host can set room name
    if (room.host !== socket.id) {
      return;
    }
    
    // Store room name
    room.roomName = roomName;
    
    // Broadcast to ALL participants in the room
    io.to(roomId).emit('room-name', { roomName });
  });

  // Screen-share signaling
  socket.on('screen-share-started', (roomId) => {
    socket.to(roomId).emit('screen-share-started');
  });

  socket.on('screen-share-stopped', (roomId) => {
    socket.to(roomId).emit('screen-share-stopped');
  });

  // Handle meeting end
  socket.on('end-meeting', ({ roomId, endedBy }) => {
    socket.to(roomId).emit('meeting-ended', { endedBy });
    
    if (rooms.has(roomId)) {
      rooms.delete(roomId);
    }
  });

  // Manual leave
  socket.on('leave-room', roomId => {
    if (!rooms.has(roomId)) {
      return;
    }
    
    const room = rooms.get(roomId);
    room.participants.delete(socket.id);
    socket.leave(roomId);
    
    if (room.host === socket.id) {
      socket.to(roomId).emit('host-left');
      
      const remainingParticipants = Array.from(room.participants);
      if (remainingParticipants.length > 0) {
        room.host = remainingParticipants[0];
      }
    } else {
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
      io.to(roomId).emit('room-status', statusData);
    }
  });

  // Disconnect cleanup
  socket.on('disconnect', reason => {
    if (currentRoom && rooms.has(currentRoom)) {
      const room = rooms.get(currentRoom);
      room.participants.delete(socket.id);

      if (room.host === socket.id && room.participants.size > 0) {
        socket.to(currentRoom).emit('host-left');
        
        const remainingParticipants = Array.from(room.participants);
        if (remainingParticipants.length > 0) {
          room.host = remainingParticipants[0];
        }
      } else {
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
        io.to(currentRoom).emit('room-status', statusData);
      }
    }
  });
});

// Health check endpoint
app.get('/health', (_, res) => {
  const roomDetails = {};
  for (const [roomId, room] of rooms.entries()) {
    roomDetails[roomId] = {
      participants: room.participants.size,
      participantIds: Array.from(room.participants),
      host: room.host,
      roomName: room.roomName || 'Unnamed',
      createdAt: new Date(room.createdAt).toISOString()
    };
  }
  
  res.json({ 
    status: 'OK', 
    totalRooms: rooms.size,
    rooms: roomDetails
  });
});

// Room info endpoint
app.get('/rooms/:roomId', (req, res) => {
  const roomId = req.params.roomId;
  const room = rooms.get(roomId);
  
  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }
  
  res.json({
    roomId,
    roomName: room.roomName || 'Unnamed',
    participantCount: room.participants.size,
    participants: Array.from(room.participants),
    host: room.host,
    createdAt: new Date(room.createdAt).toISOString(),
    isFull: room.participants.size >= 2
  });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});