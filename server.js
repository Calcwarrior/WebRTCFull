const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fetch = require('node-fetch'); // Add node-fetch for server-side API calls

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Add startup log
console.log('Server starting up...');

// Helper function to decode Base64 strings
function decodeBase64(str) {
    return decodeURIComponent(Buffer.from(str, 'base64').toString('binary').split('').map(function (c) {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));
}

// Function to fetch trivia questions from Open Trivia DB for the server
async function fetchTriviaQuestionsServer() {
    try {
        const response = await fetch('https://opentdb.com/api.php?amount=5&encode=base64');
        const data = await response.json();

        if (data.response_code === 0) {
            const questions = data.results.map(q => {
                const options = [...q.incorrect_answers.map(decodeBase64), decodeBase64(q.correct_answer)];
                // Shuffle options (optional on server, but good for consistency)
                for (let i = options.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [options[i], options[j]] = [options[j], options[i]];
                }
                const correctIndex = options.indexOf(decodeBase64(q.correct_answer));
                return {
                    question: decodeBase64(q.question),
                    options: options,
                    correct: correctIndex
                };
            });
            console.log('Fetched trivia questions on server:', questions);
            return questions;
        } else {
            console.error('Error fetching trivia questions on server, response code:', data.response_code);
            return null;
        }
    } catch (error) {
        console.error('Error fetching trivia questions on server:', error);
        return null;
    }
}

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
  socket.on('start-game', async () => {
    const meetingId = socket.meetingId;
    if (meetingId && meetings[meetingId]) {
      const fetchedQuestions = await fetchTriviaQuestionsServer();
      if (fetchedQuestions) {
        gameStates[meetingId].triviaQuestions = fetchedQuestions;
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
      } else {
        console.error('Failed to fetch trivia questions for meeting:', meetingId);
      }
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
    console.log('1. Next question handler started. Meeting ID:', meetingId);
    
    if (meetingId && gameStates[meetingId]) {
        console.log('2. Meeting and game state found');
        console.log('3. Current question before increment:', gameStates[meetingId].currentQuestion);
        
        try {
            gameStates[meetingId].currentQuestion++;
            console.log('4. Question incremented successfully');
            gameStates[meetingId].answers = {};
            console.log('5. Answers reset');

            console.log('6. After increment, current question:', gameStates[meetingId].currentQuestion);
            console.log('7. Game state:', {
                currentQuestion: gameStates[meetingId].currentQuestion,
                gameActive: gameStates[meetingId].gameActive,
                scores: gameStates[meetingId].scores
            });
            console.log(gameStates[meetingId].currentQuestion);
            if (gameStates[meetingId].currentQuestion >= 4) {
                console.log('8. Game over condition met');
                gameStates[meetingId].gameActive = false;
                console.log('9. Game state deactivated');
                console.log('10. Emitting game-over event to room:', meetingId);
                io.to(meetingId).emit('game-over', gameStates[meetingId].scores);
            } else {
                console.log('8. Emitting next-question event');
                io.to(meetingId).emit('next-question', {
                    currentQuestion: gameStates[meetingId].currentQuestion,
                    scores: gameStates[meetingId].scores
                });
            }
        } catch (error) {
            console.error('Error in next-question handler:', error);
        }
    } else {
        console.log('2. Meeting or game state not found:', {
            meetingId,
            hasGameState: !!gameStates[meetingId],
            gameStates: Object.keys(gameStates)
        });
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
    console.log('1. Reveal answers started for meeting:', meetingId);
    const gameState = gameStates[meetingId];
    const currentQuestion = gameState.currentQuestion;
    console.log('2. Current question:', currentQuestion);

    // Get the correct answer for the current question from the fetched questions
    const correctAnswer = gameState.triviaQuestions[currentQuestion].correct;
    console.log('3. Correct answer:', correctAnswer);

    // Update scores based on answers
    Object.entries(gameState.answers).forEach(([participantId, answer]) => {
        console.log('4. Processing answer for participant:', participantId, 'Answer:', answer);
        if (answer === correctAnswer) {
            gameState.scores[participantId] = (gameState.scores[participantId] || 0) + 1;
            console.log('5. Score updated for participant:', participantId, 'New score:', gameState.scores[participantId]);
        }
    });

    console.log('6. Final scores before emit:', gameState.scores);
    console.log('7. Current question before check:', currentQuestion);

    // Check if this was the last question
    if (currentQuestion >= 4) {  // Changed from 5 to 4 since we're 0-based
        console.log('8. Last question completed, ending game');
        gameState.gameActive = false;
        console.log('9. Emitting game-over event');
        io.to(meetingId).emit('game-over', gameState.scores);
    } else {
        console.log('8. Emitting reveal-answers event');
        // Emit the updated scores and answers to all participants
        io.to(meetingId).emit('reveal-answers', {
            answers: gameState.answers,
            scores: gameState.scores
        });
    }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});