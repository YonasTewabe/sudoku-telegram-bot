// =========================================================
// Telegram Mini App bootstrap
// =========================================================
const tg = window.Telegram?.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
  // Keep header/background in sync with our paper theme.
  try {
    tg.setBackgroundColor('#EAF0E6');
    tg.setHeaderColor('#EAF0E6');
  } catch (e) {
    /* older clients may not support these calls */
  }
}

// =========================================================
// Sudoku generator / validator (mirrors sudoku.py)
// =========================================================
const SIZE = 9;
const BOX = 3;

const DIFFICULTY_HOLES = { easy: 35, medium: 45, hard: 52, expert: 58 };

function shuffled(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pattern(r, c) {
  return (BOX * (r % BOX) + Math.floor(r / BOX) + c) % SIZE;
}

function generateFullBoard() {
  const base = [0, 1, 2];
  const rows = [];
  const cols = [];
  for (const g of shuffled(base)) for (const r of shuffled(base)) rows.push(g * BOX + r);
  for (const g of shuffled(base)) for (const c of shuffled(base)) cols.push(g * BOX + c);
  const nums = shuffled([1, 2, 3, 4, 5, 6, 7, 8, 9]);

  const board = [];
  for (let r = 0; r < SIZE; r++) {
    const row = [];
    for (let c = 0; c < SIZE; c++) {
      row.push(nums[pattern(rows[r], cols[c])]);
    }
    board.push(row);
  }
  return board;
}

function generatePuzzle(difficulty) {
  const solution = generateFullBoard();
  const puzzle = solution.map((row) => [...row]);

  const holes = DIFFICULTY_HOLES[difficulty] ?? 45;
  const cells = [];
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) cells.push([r, c]);
  shuffled(cells)
    .slice(0, holes)
    .forEach(([r, c]) => (puzzle[r][c] = 0));

  return { puzzle, solution };
}

// =========================================================
// Game state
// =========================================================
let solution = [];
let given = [];     // boolean grid: true = pre-filled clue
let board = [];      // current values, 0 = empty
let notes = [];      // Set<number> per cell
let selected = null; // [row, col]
let notesMode = false;
let timerInterval = null;
let secondsElapsed = 0;
let solved = false;

const boardEl = document.getElementById('board');
const messageEl = document.getElementById('message');
const timerEl = document.getElementById('timer');
const difficultyEl = document.getElementById('difficulty');
const notesBtn = document.getElementById('notesBtn');

// =========================================================
// Rendering
// =========================================================
function buildBoardDom() {
  boardEl.innerHTML = '';
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.row = r;
      cell.dataset.col = c;
      cell.setAttribute('role', 'gridcell');
      cell.addEventListener('click', () => selectCell(r, c));
      boardEl.appendChild(cell);
    }
  }
}

function cellEl(r, c) {
  return boardEl.children[r * SIZE + c];
}

function renderBoard() {
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const el = cellEl(r, c);
      const val = board[r][c];

      el.className = 'cell';
      el.innerHTML = '';

      if (given[r][c]) {
        el.classList.add('given');
        el.textContent = val;
      } else if (val !== 0) {
        el.classList.add('entry');
        el.textContent = val;
      } else if (notes[r][c].size > 0) {
        const grid = document.createElement('div');
        grid.className = 'notes-grid';
        for (let n = 1; n <= 9; n++) {
          const span = document.createElement('span');
          span.textContent = notes[r][c].has(n) ? n : '';
          grid.appendChild(span);
        }
        el.appendChild(grid);
      }
    }
  }
  applyHighlights();
}

function applyHighlights() {
  const conflicts = findConflicts();

  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const el = cellEl(r, c);
      el.classList.remove('peer', 'match', 'selected', 'error');

      if (conflicts.has(`${r},${c}`)) el.classList.add('error');

      if (selected) {
        const [sr, sc] = selected;
        const sameRow = r === sr;
        const sameCol = c === sc;
        const sameBox =
          Math.floor(r / BOX) === Math.floor(sr / BOX) &&
          Math.floor(c / BOX) === Math.floor(sc / BOX);

        if (r === sr && c === sc) {
          el.classList.add('selected');
        } else if (sameRow || sameCol || sameBox) {
          el.classList.add('peer');
        }

        const selVal = board[sr][sc];
        if (selVal !== 0 && board[r][c] === selVal) {
          el.classList.add('match');
        }
      }
    }
  }
}

// =========================================================
// Validation
// =========================================================
function findConflicts() {
  const conflicts = new Set();

  const markGroup = (cells) => {
    const seen = {};
    for (const [r, c] of cells) {
      const v = board[r][c];
      if (v === 0) continue;
      (seen[v] ||= []).push([r, c]);
    }
    for (const group of Object.values(seen)) {
      if (group.length > 1) {
        for (const [r, c] of group) conflicts.add(`${r},${c}`);
      }
    }
  };

  for (let i = 0; i < SIZE; i++) {
    markGroup([...Array(SIZE)].map((_, c) => [i, c])); // row i
    markGroup([...Array(SIZE)].map((_, r) => [r, i])); // col i
  }

  for (let br = 0; br < SIZE; br += BOX) {
    for (let bc = 0; bc < SIZE; bc += BOX) {
      const cells = [];
      for (let r = br; r < br + BOX; r++) {
        for (let c = bc; c < bc + BOX; c++) cells.push([r, c]);
      }
      markGroup(cells);
    }
  }

  return conflicts;
}

function isComplete() {
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (board[r][c] === 0) return false;
    }
  }
  return true;
}

function checkWin() {
  if (!isComplete()) return;
  if (findConflicts().size > 0) return;

  solved = true;
  stopTimer();
  messageEl.textContent = `Solved in ${formatTime(secondsElapsed)}! 🎉`;
  messageEl.classList.add('win');

  if (tg) {
    tg.HapticFeedback?.notificationOccurred('success');
    // Optionally report the result back to the bot chat:
    // tg.sendData(JSON.stringify({ event: 'solved', time: secondsElapsed, difficulty: difficultyEl.value }));
  }
}

// =========================================================
// Input handling
// =========================================================
function selectCell(r, c) {
  selected = [r, c];
  applyHighlights();
}

function setCellValue(num) {
  if (!selected || solved) return;
  const [r, c] = selected;
  if (given[r][c]) return;

  if (notesMode) {
    if (num === 0) {
      notes[r][c].clear();
    } else if (notes[r][c].has(num)) {
      notes[r][c].delete(num);
    } else {
      notes[r][c].add(num);
    }
  } else {
    board[r][c] = board[r][c] === num ? 0 : num;
    if (board[r][c] !== 0) notes[r][c].clear();
  }

  renderBoard();
  checkWin();
}

function handleKeydown(e) {
  if (!selected) return;
  const [r, c] = selected;

  if (e.key >= '1' && e.key <= '9') {
    setCellValue(Number(e.key));
  } else if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '0') {
    setCellValue(0);
  } else if (e.key === 'ArrowUp') selectCell(Math.max(0, r - 1), c);
  else if (e.key === 'ArrowDown') selectCell(Math.min(SIZE - 1, r + 1), c);
  else if (e.key === 'ArrowLeft') selectCell(r, Math.max(0, c - 1));
  else if (e.key === 'ArrowRight') selectCell(r, Math.min(SIZE - 1, c + 1));
}

// =========================================================
// Timer
// =========================================================
function formatTime(totalSeconds) {
  const m = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
  const s = (totalSeconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function startTimer() {
  stopTimer();
  secondsElapsed = 0;
  timerEl.textContent = formatTime(secondsElapsed);
  timerInterval = setInterval(() => {
    secondsElapsed += 1;
    timerEl.textContent = formatTime(secondsElapsed);
  }, 1000);
}

function stopTimer() {
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = null;
}

// =========================================================
// Game lifecycle
// =========================================================
function newGame() {
  const difficulty = difficultyEl.value;
  const { puzzle, solution: sol } = generatePuzzle(difficulty);

  solution = sol;
  board = puzzle.map((row) => [...row]);
  given = puzzle.map((row) => row.map((v) => v !== 0));
  notes = puzzle.map(() => Array.from({ length: SIZE }, () => new Set()));
  selected = null;
  solved = false;

  messageEl.textContent = '';
  messageEl.classList.remove('win');

  renderBoard();
  startTimer();
}

function giveHint() {
  if (solved) return;

  let target = selected;
  if (!target || board[target[0]][target[1]] !== 0) {
    // find any empty cell
    outer: for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (board[r][c] === 0) {
          target = [r, c];
          break outer;
        }
      }
    }
  }
  if (!target) return;

  const [r, c] = target;
  board[r][c] = solution[r][c];
  notes[r][c].clear();
  selected = [r, c];

  renderBoard();
  checkWin();
}

// =========================================================
// Wiring
// =========================================================
buildBoardDom();

document.getElementById('numpad').addEventListener('click', (e) => {
  const btn = e.target.closest('.num-btn');
  if (!btn) return;
  setCellValue(Number(btn.dataset.num));
});

notesBtn.addEventListener('click', () => {
  notesMode = !notesMode;
  notesBtn.setAttribute('aria-pressed', String(notesMode));
});

document.getElementById('hintBtn').addEventListener('click', giveHint);
document.getElementById('newGameBtn').addEventListener('click', newGame);
difficultyEl.addEventListener('change', newGame);
document.addEventListener('keydown', handleKeydown);

newGame();
