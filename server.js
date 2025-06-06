// server.js - Node.js WebRTC Signaling Server
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Serve static files (your HTML file)
app.use(express.static('public'));

// Store active rooms and their participants
const rooms = new Map();

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // Handle creating a new room
    socket.on('create-room', (roomCode) => {
        console.log(`Creating room: ${roomCode}`);
        
        if (rooms.has(roomCode)) {
            socket.emit('room-error', { message: 'Room already exists' });
            return;
        }

        // Create new room
        rooms.set(roomCode, {
            creator: socket.id,
            participants: [socket.id],
            createdAt: Date.now()
        });

        socket.join(roomCode);
        socket.roomCode = roomCode;
        socket.emit('room-created', { roomCode });
        
        console.log(`Room ${roomCode} created by ${socket.id}`);
    });

    // Handle joining an existing room
    socket.on('join-room', (roomCode) => {
        console.log(`${socket.id} attempting to join room: ${roomCode}`);
        
        const room = rooms.get(roomCode);
        
        if (!room) {
            socket.emit('room-error', { message: 'Room not found' });
            return;
        }

        if (room.participants.length >= 2) {
            socket.emit('room-error', { message: 'Room is full' });
            return;
        }

        // Add participant to room
        room.participants.push(socket.id);
        socket.join(roomCode);
        socket.roomCode = roomCode;

        // Notify both participants that room is ready
        socket.emit('room-joined', { roomCode });
        socket.to(roomCode).emit('participant-joined', { participantId: socket.id });
        
        console.log(`${socket.id} joined room ${roomCode}`);
        
        // If room now has 2 participants, start the call
        if (room.participants.length === 2) {
            io.to(roomCode).emit('room-ready');
        }
    });

    // Handle WebRTC offer
    socket.on('offer', (data) => {
        console.log('Relaying offer from', socket.id);
        socket.to(socket.roomCode).emit('offer', {
            offer: data.offer,
            from: socket.id
        });
    });

    // Handle WebRTC answer
    socket.on('answer', (data) => {
        console.log('Relaying answer from', socket.id);
        socket.to(socket.roomCode).emit('answer', {
            answer: data.answer,
            from: socket.id
        });
    });

    // Handle ICE candidates
    socket.on('ice-candidate', (data) => {
        console.log('Relaying ICE candidate from', socket.id);
        socket.to(socket.roomCode).emit('ice-candidate', {
            candidate: data.candidate,
            from: socket.id
        });
    });

    // Handle data channel messages (for game sync, etc.)
    socket.on('data-message', (data) => {
        socket.to(socket.roomCode).emit('data-message', {
            data: data.data,
            from: socket.id
        });
    });

    // Handle call end
    socket.on('end-call', () => {
        console.log('Call ended by', socket.id);
        if (socket.roomCode) {
            socket.to(socket.roomCode).emit('call-ended');
            
            // Clean up room
            const room = rooms.get(socket.roomCode);
            if (room) {
                room.participants = room.participants.filter(id => id !== socket.id);
                if (room.participants.length === 0) {
                    rooms.delete(socket.roomCode);
                    console.log(`Room ${socket.roomCode} deleted`);
                }
            }
        }
    });

    // Handle disconnect
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        
        if (socket.roomCode) {
            const room = rooms.get(socket.roomCode);
            if (room) {
                // Remove participant from room
                room.participants = room.participants.filter(id => id !== socket.id);
                
                // Notify other participant
                socket.to(socket.roomCode).emit('participant-left', { participantId: socket.id });
                
                // Delete room if empty
                if (room.participants.length === 0) {
                    rooms.delete(socket.roomCode);
                    console.log(`Room ${socket.roomCode} deleted due to disconnect`);
                }
            }
        }
    });

    // Get room info (for debugging)
    socket.on('get-rooms', () => {
        const roomList = Array.from(rooms.entries()).map(([code, room]) => ({
            code,
            participants: room.participants.length,
            createdAt: room.createdAt
        }));
        socket.emit('rooms-list', roomList);
    });
});

// Clean up old empty rooms every 10 minutes
setInterval(() => {
    const now = Date.now();
    const roomsToDelete = [];
    
    rooms.forEach((room, code) => {
        // Delete rooms older than 1 hour with no participants
        if (room.participants.length === 0 && (now - room.createdAt) > 3600000) {
            roomsToDelete.push(code);
        }
    });
    
    roomsToDelete.forEach(code => {
        rooms.delete(code);
        console.log(`Cleaned up old room: ${code}`);
    });
}, 600000); // Run every 10 minutes

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Signaling server running on port ${PORT}`);
    console.log(`Open http://localhost:${PORT} to access the application`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully');
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('SIGINT received, shutting down gracefully');
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});