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
// Stats API helpers
// =========================================================
const BASE_URL = ''; // same origin — served by FastAPI

/**
 * Return the Telegram initData string, or null when running outside Telegram.
 * We send this with every API request so the server can authenticate the call.
 */
function getInitData() {
  return tg?.initData || null;
}

async function apiPost(path, body) {
  const initData = getInitData();
  if (!initData) return; // no Telegram context — skip silently
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ init_data: initData, ...body }),
    });
    if (!res.ok) console.warn(`Stats API ${path} returned ${res.status}`);
    return res.ok ? res.json() : null;
  } catch (e) {
    console.warn('Stats API error:', e);
  }
}

/** Render the stats panel using the response from any stats API call. */
function renderStats(stats) {
  if (!stats) return;
  const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val ?? '—'; };

  const difficulties = ['easy', 'medium', 'hard', 'expert'];

  // Per-difficulty cards
  for (const d of difficulties) {
    const s = stats.byDifficulty?.[d];
    const fmt = (v) => v != null ? formatTime(v) : null;

    setEl(`stats-${d}-played`,      s?.played      ?? 0);
    setEl(`stats-${d}-won`,         s?.won         ?? 0);
    setEl(`stats-${d}-abandoned`,   s?.abandoned   ?? 0);
    setEl(`stats-${d}-streak`,      s?.currentStreak ?? 0);
    setEl(`stats-${d}-best-streak`, s?.bestStreak  ?? 0);
    setEl(`stats-${d}-hints`,       s?.totalHints  ?? 0);
    setEl(`stats-${d}-mistakes`,    s?.totalMistakes ?? 0);
    setEl(`stats-${d}-best`,        fmt(s?.bestTime));
    setEl(`stats-${d}-avg`,         fmt(s?.avgTime));
    setEl(`stats-${d}-worst`,       fmt(s?.worstTime));

    // Update the collapsed summary line: "12 played · 8 won"
    const summaryEl = document.getElementById(`${d}-summary`);
    if (summaryEl) {
      const p = s?.played ?? 0;
      const w = s?.won    ?? 0;
      summaryEl.textContent = p > 0 ? `${p} played · ${w} won` : 'No games yet';
    }
  }

  // Global summary
  const g = stats.global ?? {};
  setEl('stats-global-played',      g.played       ?? 0);
  setEl('stats-global-won',         g.won          ?? 0);
  setEl('stats-global-abandoned',   g.abandoned    ?? 0);
  setEl('stats-global-streak',      g.currentStreak ?? 0);
  setEl('stats-global-best-streak', g.bestStreak   ?? 0);

  // Empty-state: hide if anything has been played
  const statsEmptyEl = document.getElementById('statsEmpty');
  if (statsEmptyEl) {
    const anyPlayed = difficulties.some((d) => (stats.byDifficulty?.[d]?.played ?? 0) > 0);
    statsEmptyEl.style.display = anyPlayed ? 'none' : 'block';
  }
}

// =========================================================
// Game state
// =========================================================
let solution = [];
let given = [];     // boolean grid: true = pre-filled clue
let locked = [];    // boolean grid: true = locked by completed group
let board = [];      // current values, 0 = empty
let notes = [];      // Set<number> per cell
let selected = null; // [row, col]
let notesMode = false;
let timerInterval = null;
let secondsElapsed = 0;
let solved = false;

// Per-game counters tracked for the stats API
let hintsUsed = 0;   // incremented in giveHint()
let mistakes = 0;    // incremented when a placed digit conflicts, then corrected
let gameStarted = false; // true once a puzzle is in progress (not yet solved/abandoned)
let currentDifficulty = 'medium'; // difficulty of the puzzle currently in play

// Hint cooldown
const HINT_COOLDOWN_SECONDS = 10;
let lastHintTime = null; // Date or null

const boardEl = document.getElementById('board');
const messageEl = document.getElementById('message');
const timerEl = document.getElementById('timer');
const difficultyEl = document.getElementById('difficulty');
const notesBtn = document.getElementById('notesBtn');
const hintBtn = document.getElementById('hintBtn');
const numpadEl = document.getElementById('numpad');

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
      } else if (locked[r][c]) {
        el.classList.add('locked');
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
  updateNumpadDisabled();
  updateHintButton();
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
          if (!locked[r][c]) el.classList.add('selected');
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
// Number completion — disable numpad buttons for full digits
// =========================================================
function countDigitsOnBoard() {
  const counts = new Array(10).fill(0); // index 1-9
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const v = board[r][c];
      if (v !== 0) counts[v]++;
    }
  }
  return counts;
}

function updateNumpadDisabled() {
  const counts = countDigitsOnBoard();
  numpadEl.querySelectorAll('.num-btn').forEach((btn) => {
    const num = Number(btn.dataset.num);
    if (num === 0) return; // erase button — never disable
    const full = counts[num] >= SIZE;
    btn.disabled = full;
    btn.classList.toggle('num-complete', full);
  });
}

// =========================================================
// Row / column / box completion flash
// =========================================================
function flashCells(cells) {
  for (const [r, c] of cells) {
    const el = cellEl(r, c);
    el.classList.add('group-complete');
    setTimeout(() => el.classList.remove('group-complete'), 700);
  }
  if (tg) tg.HapticFeedback?.impactOccurred('light');
}

function lockCells(cells) {
  for (const [r, c] of cells) {
    locked[r][c] = true;
  }
}

function checkGroupCompletions(prevBoard) {
  const conflicts = findConflicts();
  if (conflicts.size > 0) return;

  // rows
  for (let r = 0; r < SIZE; r++) {
    const cells = [...Array(SIZE)].map((_, c) => [r, c]);
    const nowFull = cells.every(([row, col]) => board[row][col] !== 0);
    const wasFull = cells.every(([row, col]) => prevBoard[row][col] !== 0);
    if (nowFull && !wasFull) { flashCells(cells); lockCells(cells); }
  }
  // cols
  for (let c = 0; c < SIZE; c++) {
    const cells = [...Array(SIZE)].map((_, r) => [r, c]);
    const nowFull = cells.every(([row, col]) => board[row][col] !== 0);
    const wasFull = cells.every(([row, col]) => prevBoard[row][col] !== 0);
    if (nowFull && !wasFull) { flashCells(cells); lockCells(cells); }
  }
  // boxes
  for (let br = 0; br < SIZE; br += BOX) {
    for (let bc = 0; bc < SIZE; bc += BOX) {
      const cells = [];
      for (let r = br; r < br + BOX; r++) {
        for (let c = bc; c < bc + BOX; c++) cells.push([r, c]);
      }
      const nowFull = cells.every(([row, col]) => board[row][col] !== 0);
      const wasFull = cells.every(([row, col]) => prevBoard[row][col] !== 0);
      if (nowFull && !wasFull) { flashCells(cells); lockCells(cells); }
    }
  }

  // re-render to apply locked styles after locking
  renderBoard();
}

// =========================================================
// Hint cooldown
// =========================================================
let hintCooldownInterval = null;

function updateHintButton() {
  if (!lastHintTime) {
    hintBtn.disabled = false;
    hintBtn.querySelector('.tool-label').textContent = 'Hint';
    return;
  }
  const elapsed = (Date.now() - lastHintTime) / 1000;
  const remaining = Math.ceil(HINT_COOLDOWN_SECONDS - elapsed);
  if (remaining <= 0) {
    hintBtn.disabled = false;
    hintBtn.querySelector('.tool-label').textContent = 'Hint';
    if (hintCooldownInterval) { clearInterval(hintCooldownInterval); hintCooldownInterval = null; }
  } else {
    hintBtn.disabled = true;
    hintBtn.querySelector('.tool-label').textContent = `Hint (${remaining}s)`;
  }
}

function startHintCooldown() {
  lastHintTime = Date.now();
  if (hintCooldownInterval) clearInterval(hintCooldownInterval);
  hintCooldownInterval = setInterval(() => {
    const elapsed = (Date.now() - lastHintTime) / 1000;
    const remaining = Math.ceil(HINT_COOLDOWN_SECONDS - elapsed);
    if (remaining <= 0) {
      clearInterval(hintCooldownInterval);
      hintCooldownInterval = null;
      hintBtn.disabled = false;
      hintBtn.querySelector('.tool-label').textContent = 'Hint';
    } else {
      hintBtn.querySelector('.tool-label').textContent = `Hint (${remaining}s)`;
    }
  }, 500);
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
  gameStarted = false;
  stopTimer();
  messageEl.textContent = `Solved in ${formatTime(secondsElapsed)}! 🎉`;
  messageEl.classList.add('win');

  if (tg) {
    tg.HapticFeedback?.notificationOccurred('success');
  }

  // Report the win to the stats API.
  apiPost('/api/stats/win', {
    difficulty:   currentDifficulty,
    time_seconds: secondsElapsed,
    hints_used:   hintsUsed,
    mistakes:     mistakes,
  }).then(renderStats);
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
  if (given[r][c] || locked[r][c]) return;

  // snapshot board before change for completion detection
  const prevBoard = board.map((row) => [...row]);

  if (notesMode) {
    if (num === 0) {
      notes[r][c].clear();
    } else if (notes[r][c].has(num)) {
      notes[r][c].delete(num);
    } else {
      notes[r][c].add(num);
    }
  } else {
    // Detect a mistake: placing a wrong digit (conflicts with solution) that
    // replaces either an empty cell or a previously wrong digit.
    const wasWrong = prevBoard[r][c] !== 0 && prevBoard[r][c] !== solution[r][c];
    const isWrong  = num !== 0 && num !== solution[r][c];
    if (isWrong && !wasWrong) {
      // Player is placing an incorrect digit for the first time in this cell.
      mistakes++;
    }

    board[r][c] = board[r][c] === num ? 0 : num;
    if (board[r][c] !== 0) notes[r][c].clear();
  }

  renderBoard();

  if (!notesMode) {
    checkGroupCompletions(prevBoard);
    // clear notes for this number from peers when digit is placed
    if (board[r][c] !== 0) clearNotesForPlacedDigit(r, c, board[r][c]);
  }

  checkWin();
}

// Remove a digit from notes in the same row, col, and box as a placed cell
function clearNotesForPlacedDigit(row, col, digit) {
  const boxR = Math.floor(row / BOX) * BOX;
  const boxC = Math.floor(col / BOX) * BOX;
  for (let i = 0; i < SIZE; i++) {
    notes[row][i].delete(digit);
    notes[i][col].delete(digit);
  }
  for (let r = boxR; r < boxR + BOX; r++) {
    for (let c = boxC; c < boxC + BOX; c++) {
      notes[r][c].delete(digit);
    }
  }
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

  // If a puzzle was in progress (started but not solved), count it as abandoned.
  // Use `currentDifficulty` — the difficulty of the game being abandoned, which
  // may differ from `difficulty` when the player changed the dropdown.
  if (gameStarted && !solved) {
    apiPost('/api/stats/abandon', { difficulty: currentDifficulty });
  }

  // The new game's difficulty becomes current.
  currentDifficulty = difficulty;

  const { puzzle, solution: sol } = generatePuzzle(difficulty);

  solution = sol;
  board = puzzle.map((row) => [...row]);
  given = puzzle.map((row) => row.map((v) => v !== 0));
  locked = puzzle.map(() => new Array(SIZE).fill(false));
  notes = puzzle.map(() => Array.from({ length: SIZE }, () => new Set()));
  selected = null;
  solved = false;

  // Reset per-game counters.
  hintsUsed = 0;
  mistakes = 0;
  gameStarted = true;

  // reset hint cooldown
  lastHintTime = null;
  if (hintCooldownInterval) { clearInterval(hintCooldownInterval); hintCooldownInterval = null; }

  messageEl.textContent = '';
  messageEl.classList.remove('win');

  renderBoard();
  startTimer();

  // Tell the server a new game has started (increments `played`).
  apiPost('/api/stats/game-start', { difficulty: currentDifficulty }).then(renderStats);
}

function giveHint() {
  if (solved) return;
  if (lastHintTime && (Date.now() - lastHintTime) / 1000 < HINT_COOLDOWN_SECONDS) return;

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

  const prevBoard = board.map((row) => [...row]);
  const [r, c] = target;
  board[r][c] = solution[r][c];
  notes[r][c].clear();
  clearNotesForPlacedDigit(r, c, board[r][c]);
  selected = [r, c];

  // Track hint usage for end-of-game stats reporting.
  hintsUsed++;

  renderBoard();
  checkGroupCompletions(prevBoard);
  checkWin();
  startHintCooldown();
}

// =========================================================
// Wiring
// =========================================================
buildBoardDom();

// Pick a random difficulty on every fresh load
const DIFFICULTIES = ['easy', 'medium', 'hard', 'expert'];
difficultyEl.value = DIFFICULTIES[Math.floor(Math.random() * DIFFICULTIES.length)];

document.getElementById('numpad').addEventListener('click', (e) => {
  const btn = e.target.closest('.num-btn');
  if (!btn || btn.disabled) return;
  setCellValue(Number(btn.dataset.num));
});

notesBtn.addEventListener('click', () => {
  notesMode = !notesMode;
  notesBtn.setAttribute('aria-pressed', String(notesMode));
});

hintBtn.addEventListener('click', giveHint);
document.getElementById('newGameBtn').addEventListener('click', newGame);
difficultyEl.addEventListener('change', newGame);
document.addEventListener('keydown', handleKeydown);

// =========================================================
// Stats sheet
// =========================================================
const statsSheet    = document.getElementById('statsSheet');
const statsBackdrop = document.getElementById('statsBackdrop');
const statsEmpty    = document.getElementById('statsEmpty');

function openStats() {
  // Auto-expand the card matching the current difficulty
  document.querySelectorAll('.diff-card').forEach((card) => {
    card.classList.toggle('open', card.dataset.diff === currentDifficulty);
  });

  statsSheet.classList.add('open');
  statsSheet.setAttribute('aria-hidden', 'false');
  statsBackdrop.classList.add('open');
  statsBackdrop.setAttribute('aria-hidden', 'false');

  // Fetch fresh stats from the server whenever the panel opens.
  const initData = getInitData();
  if (initData) {
    fetch(`${BASE_URL}/api/stats?init_data=${encodeURIComponent(initData)}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (data) renderStats(data); })
      .catch((e) => console.warn('Stats fetch error:', e));
  }
}

function closeStats() {
  statsSheet.classList.remove('open');
  statsSheet.setAttribute('aria-hidden', 'true');
  statsBackdrop.classList.remove('open');
  statsBackdrop.setAttribute('aria-hidden', 'true');
}

document.getElementById('statsBtn').addEventListener('click', openStats);
document.getElementById('statsClose').addEventListener('click', closeStats);
statsBackdrop.addEventListener('click', closeStats);

// Accordion: toggle difficulty cards on header click
document.querySelectorAll('.diff-card-header').forEach((header) => {
  header.addEventListener('click', () => {
    const card = header.closest('.diff-card');
    card.classList.toggle('open');
  });
});

// Close on Escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && statsSheet.classList.contains('open')) closeStats();
});

newGame();
