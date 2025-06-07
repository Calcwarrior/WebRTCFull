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

// Trivia questions
const triviaQuestions = [
  {
    question: "What is the capital of France?",
    options: ["London", "Berlin", "Paris", "Madrid"],
    correct: 2
  },
  {
    question: "Which planet is known as the Red Planet?",
    options: ["Venus", "Mars", "Jupiter", "Saturn"],
    correct: 1
  },
  {
    question: "What is the largest mammal in the world?",
    options: ["African Elephant", "Blue Whale", "Giraffe", "Hippopotamus"],
    correct: 1
  },
  {
    question: "Who painted the Mona Lisa?",
    options: ["Vincent van Gogh", "Pablo Picasso", "Leonardo da Vinci", "Michelangelo"],
    correct: 2
  },
  {
    question: "What is the chemical symbol for gold?",
    options: ["Ag", "Fe", "Au", "Cu"],
    correct: 2
  }
];

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Store meeting rooms and their participants
const meetings = {};
const gameStates = {};

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Join a meeting room
  socket.on('join-meeting', (meetingId) => {
    console.log(`User ${socket.id} joining meeting ${meetingId}`);

    // Leave any previous room
    const previousRooms = Array.from(socket.rooms).filter(room => room !== socket.id);
    previousRooms.forEach(room => socket.leave(room));

    // Join the new meeting room
    socket.join(meetingId);
    socket.meetingId = meetingId;

    // Initialize meeting if it doesn't exist
    if (!meetings[meetingId]) {
      meetings[meetingId] = {
        participants: [],
        gameActive: false
      };
      gameStates[meetingId] = {
        scores: {},
        currentQuestion: 0,
        answers: {},
        timer: null,
        gameActive: false
      };
    }

    // Add participant if not already in the meeting
    if (!meetings[meetingId].participants.includes(socket.id)) {
      meetings[meetingId].participants.push(socket.id);
      gameStates[meetingId].scores[socket.id] = 0;
    }

    // Notify other participants
    socket.to(meetingId).emit('user-joined', socket.id);

    // Send current participants to the new user
    socket.emit('participants', meetings[meetingId].participants.filter(id => id !== socket.id));

    // Send current game state if game is active
    if (gameStates[meetingId].gameActive) {
      socket.emit('game-started', {
        currentQuestion: gameStates[meetingId].currentQuestion,
        scores: gameStates[meetingId].scores
      });
    }
  });

  // WebRTC signaling
  socket.on('offer', (data) => {
    socket.to(data.target).emit('offer', {
      offer: data.offer,
      sender: socket.id
    });
  });

  socket.on('answer', (data) => {
    socket.to(data.target).emit('answer', {
      answer: data.answer,
      sender: socket.id
    });
  });

  socket.on('ice-candidate', (data) => {
    socket.to(data.target).emit('ice-candidate', {
      candidate: data.candidate,
      sender: socket.id
    });
  });

  // Game events
  socket.on('start-game', () => {
    const meetingId = socket.meetingId;
    if (meetingId && meetings[meetingId]) {
      gameStates[meetingId].gameActive = true;
      gameStates[meetingId].currentQuestion = 0;
      gameStates[meetingId].answers = {};

      // Reset scores
      meetings[meetingId].participants.forEach(participantId => {
        gameStates[meetingId].scores[participantId] = 0;
      });

      io.to(meetingId).emit('game-started', {
        currentQuestion: 0,
        scores: gameStates[meetingId].scores
      });
    }
  });

  socket.on('submit-answer', (data) => {
    const meetingId = socket.meetingId;
    if (meetingId && gameStates[meetingId]) {
      gameStates[meetingId].answers[socket.id] = data.answer;

      // Check if all participants have answered
      const totalParticipants = meetings[meetingId].participants.length;
      const answeredParticipants = Object.keys(gameStates[meetingId].answers).length;

      if (answeredParticipants === totalParticipants) {
        // All answered, reveal results immediately
        revealAnswers(meetingId);
      }
    }
  });

  socket.on('next-question', () => {
    const meetingId = socket.meetingId;
    if (meetingId && gameStates[meetingId]) {
      gameStates[meetingId].currentQuestion++;
      gameStates[meetingId].answers = {};

      if (gameStates[meetingId].currentQuestion >= 5) {
        // Game over
        gameStates[meetingId].gameActive = false;
        io.to(meetingId).emit('game-over', gameStates[meetingId].scores);
      } else {
        io.to(meetingId).emit('next-question', {
          currentQuestion: gameStates[meetingId].currentQuestion,
          scores: gameStates[meetingId].scores
        });
      }
    }
  });

  // End call
  socket.on('end-call', () => {
    const meetingId = socket.meetingId;
    if (meetingId) {
      io.to(meetingId).emit('call-ended');
    }
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);

    const meetingId = socket.meetingId;
    if (meetingId && meetings[meetingId]) {
      // Remove participant
      meetings[meetingId].participants = meetings[meetingId].participants.filter(id => id !== socket.id);
      delete gameStates[meetingId].scores[socket.id];

      // Notify other participants
      socket.to(meetingId).emit('user-left', socket.id);

      // Clean up empty meetings
      if (meetings[meetingId].participants.length === 0) {
        delete meetings[meetingId];
        delete gameStates[meetingId];
      }
    }
  });
});

function revealAnswers(meetingId) {
  const gameState = gameStates[meetingId];
  const currentQuestion = gameState.currentQuestion;

  // Get the correct answer for the current question
  const correctAnswer = triviaQuestions[currentQuestion].correct;

  // Update scores based on answers
  Object.entries(gameState.answers).forEach(([participantId, answer]) => {
    if (answer === correctAnswer) {
      gameState.scores[participantId] = (gameState.scores[participantId] || 0) + 1;
    }
  });

  // Emit the updated scores and answers to all participants
  io.to(meetingId).emit('reveal-answers', {
    answers: gameState.answers,
    scores: gameState.scores
  });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});