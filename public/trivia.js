// Game variables
let currentQuestion = 0;
let gameActive = false;
let selectedAnswer = null;
let timeLeft = 5;
let timerInterval;
let scores = {}; // Initialize scores as an empty object
let triviaQuestions = []; // Will store fetched questions

// Get socket from window object
const socket = window.socket;

// Socket event listeners
socket.on('game-started', (data) => {
    console.log('Game started event received:', data);
    gameActive = true;
    currentQuestion = data.currentQuestion;
    scores = data.scores;
    triviaQuestions = data.triviaQuestions; // Update client's triviaQuestions with data from server
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

// Add new socket event for UI synchronization
socket.on('show-game-sidebar', () => {
    showGameSettings();
});

socket.on('show-game-selection', () => {
    showGameSelection();
});

// Helper function to decode Base64 strings
function decodeBase64(str) {
    return decodeURIComponent(atob(str).split('').map(function (c) {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));
}

// Function to fetch trivia questions from Open Trivia DB
async function fetchTriviaQuestions() {
    const numQuestions = document.getElementById('numQuestions').value;
    const difficulty = document.querySelector('input[name="difficulty"]:checked').value;
    
    let apiUrl = `https://opentdb.com/api.php?amount=${numQuestions}&encode=base64`;
    if (difficulty !== 'any') {
        apiUrl += `&difficulty=${difficulty}`;
    }

    console.log('Fetching trivia questions with settings:', {
        numQuestions,
        difficulty,
        apiUrl
    });

    try {
        const response = await fetch(apiUrl);
        const data = await response.json();

        if (data.response_code === 0) {
            console.log('Successfully fetched questions. First question:', {
                question: decodeBase64(data.results[0].question),
                difficulty: decodeBase64(data.results[0].difficulty)
            });
            
            triviaQuestions = data.results.map(q => {
                const options = [...q.incorrect_answers.map(decodeBase64), decodeBase64(q.correct_answer)];
                // Shuffle options to ensure correct answer isn't always in the same spot
                for (let i = options.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [options[i], options[j]] = [options[j], options[i]];
                }
                const correctIndex = options.indexOf(decodeBase64(q.correct_answer));
                return {
                    question: decodeBase64(q.question),
                    options: options,
                    correct: correctIndex,
                    difficulty: decodeBase64(q.difficulty) // Store the difficulty for verification
                };
            });
            console.log('Fetched trivia questions:', triviaQuestions);
            return true;
        } else {
            console.error('Error fetching trivia questions, response code:', data.response_code);
            // Handle different response codes as needed (e.g., token empty, no results)
            alert('Could not fetch trivia questions. Please try again later.');
            return false;
        }
    } catch (error) {
        console.error('Error fetching trivia questions:', error);
        alert('An error occurred while fetching trivia questions.');
        return false;
    }
}

// Game functions
async function startGame() {
    // Clear previous game content
    triviaGameContent.innerHTML = '';

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
    document.getElementById('totalQuestions').textContent = document.getElementById('numQuestions').value;
    
    // Show timer and emit event to other users
    const timer = document.getElementById('timer');
    timer.style.display = 'block';
    socket.emit('show-timer');

    // Fetch questions based on settings
    const fetched = await fetchTriviaQuestions();
    if (fetched) {
        console.log('Client: Emitting start-game event with questions.');
        // Emit start game event along with fetched questions
        socket.emit('start-game', { triviaQuestions: triviaQuestions });
    }
}

function displayQuestion() {
    console.log("Displaying question:", currentQuestion);
    console.log("Trivia questions array:", triviaQuestions);

    // Check if we've reached the end of the questions
    if (currentQuestion >= triviaQuestions.length) {
        console.log("Game complete - showing game over screen");
        showGameOver();
        return;
    }

    const question = triviaQuestions[currentQuestion];
    if (!question) {
        console.error("Error: Question not found at index", currentQuestion, "in triviaQuestions array.");
        showGameOver(); // Show game over screen if we hit an error
        return;
    }
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
    console.log("Calling displayQuestion() with currentQuestion:", currentQuestion, "and triviaQuestions length:", triviaQuestions.length);
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
        if (currentQuestion < triviaQuestions.length - 1) {
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
    gameActive = false;
    clearInterval(timerInterval);
    
    // Calculate final scores
    const yourScore = scores[socket.id] || 0;
    const opponentScore = Object.entries(scores)
        .filter(([id]) => id !== socket.id)
        .reduce((sum, [_, score]) => sum + score, 0);

    // Determine game result
    let resultClass = 'tie';
    let resultEmoji = '🤝';
    let resultText = "It's a tie!";

    if (yourScore > opponentScore) {
        resultClass = 'win';
        resultEmoji = '🎉';
        resultText = 'You won!';
    } else if (yourScore < opponentScore) {
        resultClass = 'lose';
        resultEmoji = '😢';
        resultText = 'You lost!';
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
                    <div class="score-value">${yourScore}</div>
                </div>
                <div class="score-divider">vs</div>
                <div class="score-card">
                    <div class="score-label">Opponent's Score</div>
                    <div class="score-value">${opponentScore}</div>
                </div>
            </div>
            <div class="game-over-actions">
                <button class="next-btn" onclick="showGameSettings()">Play Again</button>
            </div>
        </div>
    `;
}

// Add socket listener for timer display
socket.on('show-timer', () => {
    const timer = document.getElementById('timer');
    if (timer) {
        timer.style.display = 'block';
    }
});

// Initialize the game sidebar when page loads
showStartGameButton(); 