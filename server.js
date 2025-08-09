// server.js
/* eslint-disable no-console */
require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.set('trust proxy', 1);

// ----- CORS -----
const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map(s => s.trim()).filter(Boolean)
  : ['http://localhost:3000']; // add your Netlify URL in env at deploy

app.use(cors({ origin: allowedOrigins, credentials: true }));

const server = http.createServer(app);

const io = new Server(server, {
  path: process.env.SOCKET_PATH || '/socket.io', // must match client
  cors: {
    origin: allowedOrigins,
    credentials: true,
    methods: ['GET', 'POST'],
  },
  transports: ['websocket', 'polling'], // let it fall back if WS is blocked
  maxHttpBufferSize: 10 * 1024 * 1024,
  pingInterval: 25000,
  pingTimeout: 30000,
});

// ===== In-memory room store =====
/** roomId -> { participants:Set<string>, host:string|null, createdAt:number, roomName:string } */
const rooms = new Map();

function cleanupRoom(roomId) {
  const room = rooms.get(roomId);
  if (room && room.participants.size === 0) rooms.delete(roomId);
}

function getOrCreateRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      participants: new Set(),
      host: null,
      createdAt: Date.now(),
      roomName: '',
    });
  }
  return rooms.get(roomId);
}

io.on('connection', (socket) => {
  let currentRoom = null;

  socket.on('background-sync', ({ roomId, backgroundUrl }) => {
    socket.to(roomId).emit('background-sync', { backgroundUrl });
  });

  socket.on('join-room', (roomId) => {
    const room = getOrCreateRoom(roomId);

    if (room.participants.has(socket.id)) {
      currentRoom = roomId;
      socket.join(roomId);
      if (room.roomName) socket.emit('room-name', { roomName: room.roomName });
      return;
    }

    if (room.participants.size >= 2) {
      socket.emit('room-full');
      return;
    }

    room.participants.add(socket.id);
    currentRoom = roomId;
    socket.join(roomId);

    if (!room.host) room.host = socket.id;

    if (room.roomName) socket.emit('room-name', { roomName: room.roomName });

    if (room.participants.size === 2) io.to(roomId).emit('peer-joined');

    io.to(roomId).emit('room-status', {
      participantCount: room.participants.size,
      maxParticipants: 2,
      isFull: room.participants.size >= 2,
    });
  });

  socket.on('check-host', (roomId, callback) => {
    const room = rooms.get(roomId);
    const isHost = !!room && room.host === socket.id;
    if (typeof callback === 'function') callback(isHost);
  });

  // WebRTC signaling
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
    if (candidate) socket.to(roomId).emit('ice-candidate', candidate);
  });

  // Names & chat
  socket.on('set-name', ({ roomId, name }) => {
    socket.to(roomId).emit('peer-name', { name, senderId: socket.id });
  });

  socket.on('chat-message', ({ roomId, sender, message, type, timestamp }) => {
    socket.to(roomId).emit('chat-message', {
      sender: sender || socket.id,
      message,
      type,
      timestamp: timestamp || Date.now(),
    });
  });

  // Room name (host only)
  socket.on('room-name', ({ roomId, roomName }) => {
    const room = rooms.get(roomId);
    if (!room || room.host !== socket.id) return;
    room.roomName = roomName;
    io.to(roomId).emit('room-name', { roomName });
  });

  // Screen share flags
  socket.on('screen-share-started', (roomId) => socket.to(roomId).emit('screen-share-started'));
  socket.on('screen-share-stopped', (roomId) => socket.to(roomId).emit('screen-share-stopped'));

  // End meeting
  socket.on('end-meeting', ({ roomId, endedBy }) => {
    socket.to(roomId).emit('meeting-ended', { endedBy });
    rooms.delete(roomId);
  });

  // Manual leave
  socket.on('leave-room', (roomId) => {
    const room = rooms.get(roomId);
    if (!room) return;

    room.participants.delete(socket.id);
    socket.leave(roomId);

    if (room.host === socket.id) {
      socket.to(roomId).emit('host-left');
      const rest = Array.from(room.participants);
      room.host = rest[0] || null;
    } else {
      socket.to(roomId).emit('peer-left');
    }

    cleanupRoom(roomId);
    currentRoom = null;

    const updated = rooms.get(roomId);
    if (updated) {
      io.to(roomId).emit('room-status', {
        participantCount: updated.participants.size,
        maxParticipants: 2,
        isFull: updated.participants.size >= 2,
      });
    }
  });

  // Disconnect
  socket.on('disconnect', () => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room) return;

    room.participants.delete(socket.id);

    if (room.host === socket.id && room.participants.size > 0) {
      socket.to(currentRoom).emit('host-left');
      const rest = Array.from(room.participants);
      room.host = rest[0] || null;
    } else {
      socket.to(currentRoom).emit('peer-left');
    }

    cleanupRoom(currentRoom);

    const updated = rooms.get(currentRoom);
    if (updated) {
      io.to(currentRoom).emit('room-status', {
        participantCount: updated.participants.size,
        maxParticipants: 2,
        isFull: updated.participants.size >= 2,
      });
    }
  });
});

// ----- HTTP routes -----
app.get('/', (_req, res) => {
  res.json({ status: 'OK', socketPath: process.env.SOCKET_PATH || '/socket.io' });
});

// Render health checks (use /healthz in the dashboard)
const health = (_req, res) => {
  const snapshot = {};
  for (const [roomId, room] of rooms.entries()) {
    snapshot[roomId] = {
      participants: room.participants.size,
      host: room.host,
      roomName: room.roomName || 'Unnamed',
      createdAt: new Date(room.createdAt).toISOString(),
    };
  }
  res.json({ status: 'OK', totalRooms: rooms.size, rooms: snapshot });
};
app.get('/healthz', health);
app.get('/health', health);

app.get('/rooms/:roomId', (req, res) => {
  const room = rooms.get(req.params.roomId);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  res.json({
    roomId: req.params.roomId,
    roomName: room.roomName || 'Unnamed',
    participantCount: room.participants.size,
    participants: Array.from(room.participants),
    host: room.host,
    createdAt: new Date(room.createdAt).toISOString(),
    isFull: room.participants.size >= 2,
  });
});

// ----- Start -----
const PORT = process.env.PORT || 4000; // Render sets PORT for you
server.listen(PORT, () => {
  console.log(`Signal server listening on ${PORT} (path ${process.env.SOCKET_PATH || '/socket.io'})`);
});
