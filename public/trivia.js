// Game variables
let currentQuestion = 0;
let gameActive = false;
let selectedAnswer = null;
let timeLeft = 5;
let timerInterval;
let scores = {}; // Initialize scores as an empty object

// Get socket from window object
const socket = window.socket;

// Socket event listeners
socket.on('game-started', (data) => {
    console.log('Game started event received:', data);
    gameActive = true;
    currentQuestion = data.currentQuestion;
    scores = data.scores;
    displayQuestion();
    updateScores();
});

socket.on('next-question', (data) => {
    console.log('Next question event received:', data);
    currentQuestion = data.currentQuestion;
    scores = data.scores;
    selectedAnswer = null;
    displayQuestion();
    updateScores();
});

socket.on('reveal-answers', (data) => {
    console.log('Reveal answers event received:', data);
    clearInterval(timerInterval);
    scores = data.scores;
    showResults(data.answers);
    updateScores();
});

socket.on('game-over', (finalScores) => {
    console.log('Game over event received with scores:', finalScores);
    gameActive = false;
    scores = finalScores;
    showGameOver();
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

// Game functions
function showTriviaGame() {
    hideSidebars();
    triviaGameSidebar.classList.add('active');
    if (!gameActive) {
        showStartGameButton();
    }
}

function showGameSelection() {
    // Reset game state
    currentQuestion = 0;
    gameActive = false;
    selectedAnswer = null;
    timeLeft = 5;
    scores = {};
    
    // Update UI
    document.getElementById('yourScore').textContent = '0';
    document.getElementById('opponentScore').textContent = '0';
    document.getElementById('questionNum').textContent = '1';
    
    // Show game selection screen
    document.getElementById('triviaGameSidebar').classList.remove('active');
    document.getElementById('gameSidebar').classList.add('active');
}

function showStartGameButton() {
    triviaGameContent.innerHTML = `
        <div style="text-align: center; padding: 40px;">
            <h4>Ready to play trivia?</h4>
            <p style="margin: 15px 0; color: #666;">Test your knowledge with 5 questions!</p>
            <button class="next-btn" onclick="startGame()">Start Game</button>
        </div>
    `;
}

function startGame() {
    // Reset game state
    currentQuestion = 0;
    gameActive = false;
    selectedAnswer = null;
    timeLeft = 5;
    scores = {};
    
    // Update UI
    document.getElementById('yourScore').textContent = '0';
    document.getElementById('opponentScore').textContent = '0';
    document.getElementById('questionNum').textContent = '1';
    
    // Emit start game event
    socket.emit('start-game');
}

function displayQuestion() {
    const question = triviaQuestions[currentQuestion];
    questionNum.textContent = currentQuestion + 1;

    triviaGameContent.innerHTML = `
        <div class="question">
            <h4>${question.question}</h4>
            <div class="options">
                ${question.options.map((option, index) => `
                    <div class="option" onclick="selectAnswer(${index})" data-index="${index}">
                        ${option}
                    </div>
                `).join('')}
            </div>
        </div>
    `;

    startTimer();
}

function selectAnswer(index) {
    if (selectedAnswer !== null) return;

    selectedAnswer = index;
    const options = document.querySelectorAll('.option');
    options.forEach(option => option.classList.remove('selected'));
    options[index].classList.add('selected');

    socket.emit('submit-answer', { answer: index });
}

function startTimer() {
    timeLeft = 5;
    timer.textContent = timeLeft;

    timerInterval = setInterval(() => {
        timeLeft--;
        timer.textContent = timeLeft;

        if (timeLeft <= 0) {
            clearInterval(timerInterval);
            if (selectedAnswer === null) {
                socket.emit('submit-answer', { answer: -1 }); // No answer selected
            }
        }
    }, 1000);
}

function showResults(answers) {
    const question = triviaQuestions[currentQuestion];
    const options = document.querySelectorAll('.option');

    options.forEach((option, index) => {
        option.classList.remove('selected');
        if (index === question.correct) {
            option.classList.add('correct');
        } else if (Object.values(answers).includes(index)) {
            // Check if *any* submitted answer matches this option (to highlight incorrect choices)
            option.classList.add('incorrect');
        }
        option.onclick = null; // Disable clicking

        // Add badges for answers chosen by users
        const chosenBy = [];
        for (const [socketId, answer] of Object.entries(answers)) {
            if (answer === index) {
                chosenBy.push(socketId === socket.id ? 'You' : 'Opponent');
            }
        }

        if (chosenBy.length > 0) {
            const badge = document.createElement('span');
            badge.classList.add('answer-badge');
            badge.textContent = chosenBy.join(', ');
            option.appendChild(badge);
        }
    });

    // Show next question button after 3 seconds
    setTimeout(() => {
        if (currentQuestion < 4) {
            triviaGameContent.innerHTML += `
                <div style="text-align: center; margin-top: 20px;">
                    <button class="next-btn" onclick="nextQuestion()">Next Question</button>
                </div>
            `;
        }
    }, 1000);
}

function nextQuestion() {
    socket.emit('next-question');
}

function updateScores() {
    const mySocketId = socket.id;
    const myScore = scores[mySocketId] || 0;
    let opponentSocketId = null;
    let opponentScoreValue = 0;

    Object.keys(scores).forEach(socketId => {
        if (socketId !== mySocketId) {
            opponentSocketId = socketId;
            opponentScoreValue = scores[socketId] || 0;
        }
    });

    yourScore.textContent = myScore;
    opponentScore.textContent = opponentScoreValue;
}

function showGameOver() {
    console.log('showGameOver function called');
    const mySocketId = socket.id;
    const myScore = scores[mySocketId] || 0;
    let opponentScore = 0;
    console.log('we are doing this');
    console.log('Current scores:', scores);
    console.log('My socket ID:', mySocketId);
    console.log('My score:', myScore);

    Object.keys(scores).forEach(socketId => {
        if (socketId !== mySocketId) {
            opponentScore = scores[socketId] || 0;
            console.log('Opponent socket ID:', socketId);
            console.log('Opponent score:', opponentScore);
        }
    });

    let resultText = '';
    let resultEmoji = '';
    let resultClass = '';

    if (myScore > opponentScore) {
        resultText = 'You Win!';
        resultEmoji = '🎉';
        resultClass = 'win';
    } else if (myScore < opponentScore) {
        resultText = 'You Lose!';
        resultEmoji = '😔';
        resultClass = 'lose';
    } else {
        resultText = "It's a Tie!";
        resultEmoji = '🤝';
        resultClass = 'tie';
    }

    triviaGameContent.innerHTML = `
        <div class="game-over ${resultClass}">
            <div class="result-header">
                <h3>${resultText}</h3>
                <div class="result-emoji">${resultEmoji}</div>
            </div>
            <div class="final-scores">
                <div class="score-card">
                    <div class="score-label">Your Score</div>
                    <div class="score-value">${myScore}</div>
                </div>
                <div class="score-divider">vs</div>
                <div class="score-card">
                    <div class="score-label">Opponent's Score</div>
                    <div class="score-value">${opponentScore}</div>
                </div>
            </div>
            <div class="game-over-actions">
                <button class="next-btn" onclick="startGame()">Play Again</button>
                <button class="back-btn" onclick="showGameSelection()">Back to Games</button>
            </div>
        </div>
    `;
}

// Initialize the game sidebar when page loads
showStartGameButton(); 