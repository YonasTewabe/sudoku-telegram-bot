// =========================================================
// Telegram Mini App bootstrap
// =========================================================
const tg = window.Telegram?.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
  try {
    tg.setBackgroundColor('#0d0f14');
    tg.setHeaderColor('#0d0f14');
  } catch (e) { /* older clients */ }
}

// =========================================================
// Sudoku generator / validator (mirrors sudoku.py)
// =========================================================
const SIZE = 9;
const BOX  = 3;
const DIFFICULTY_HOLES = { easy: 35, medium: 45, hard: 52, expert: 58 };
const DIFFICULTIES     = ['easy', 'medium', 'hard', 'expert'];

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
  const rows = [], cols = [];
  for (const g of shuffled(base)) for (const r of shuffled(base)) rows.push(g * BOX + r);
  for (const g of shuffled(base)) for (const c of shuffled(base)) cols.push(g * BOX + c);
  const nums = shuffled([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const board = [];
  for (let r = 0; r < SIZE; r++) {
    const row = [];
    for (let c = 0; c < SIZE; c++) row.push(nums[pattern(rows[r], cols[c])]);
    board.push(row);
  }
  return board;
}

function generatePuzzle(difficulty) {
  const solution = generateFullBoard();
  const puzzle   = solution.map(row => [...row]);
  const holes    = DIFFICULTY_HOLES[difficulty] ?? 45;
  const cells    = [];
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) cells.push([r, c]);
  shuffled(cells).slice(0, holes).forEach(([r, c]) => (puzzle[r][c] = 0));
  return { puzzle, solution };
}

// =========================================================
// Stats API helpers
// =========================================================
const BASE_URL = ''; // same origin — served by FastAPI

function getInitData() { return tg?.initData || null; }

async function apiPost(path, body) {
  const initData = getInitData();
  if (!initData) return;
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ init_data: initData, ...body }),
    });
    if (!res.ok) console.warn(`Stats API ${path} returned ${res.status}`);
    return res.ok ? res.json() : null;
  } catch (e) { console.warn('Stats API error:', e); }
}

function renderStats(stats) {
  if (!stats) return;
  const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val ?? '—'; };

  for (const d of DIFFICULTIES) {
    const s   = stats.byDifficulty?.[d];
    const fmt = v => v != null ? formatTime(v) : null;
    setEl(`stats-${d}-played`,      s?.played        ?? 0);
    setEl(`stats-${d}-won`,         s?.won           ?? 0);
    setEl(`stats-${d}-abandoned`,   s?.abandoned     ?? 0);
    setEl(`stats-${d}-streak`,      s?.currentStreak ?? 0);
    setEl(`stats-${d}-best-streak`, s?.bestStreak    ?? 0);
    setEl(`stats-${d}-hints`,       s?.totalHints    ?? 0);
    setEl(`stats-${d}-mistakes`,    s?.totalMistakes ?? 0);
    setEl(`stats-${d}-best`,        fmt(s?.bestTime));
    setEl(`stats-${d}-avg`,         fmt(s?.avgTime));
    setEl(`stats-${d}-worst`,       fmt(s?.worstTime));
    const summaryEl = document.getElementById(`${d}-summary`);
    if (summaryEl) {
      const p = s?.played ?? 0, w = s?.won ?? 0;
      summaryEl.textContent = p > 0 ? `${p} played · ${w} won` : 'No games yet';
    }
  }

  const g = stats.global ?? {};
  setEl('stats-global-played',      g.played        ?? 0);
  setEl('stats-global-won',         g.won           ?? 0);
  setEl('stats-global-abandoned',   g.abandoned     ?? 0);
  setEl('stats-global-streak',      g.currentStreak ?? 0);
  setEl('stats-global-best-streak', g.bestStreak    ?? 0);

  const statsEmptyEl = document.getElementById('statsEmpty');
  if (statsEmptyEl) {
    const anyPlayed = DIFFICULTIES.some(d => (stats.byDifficulty?.[d]?.played ?? 0) > 0);
    statsEmptyEl.style.display = anyPlayed ? 'none' : 'block';
  }
}

// =========================================================
// Game persistence (localStorage)
// =========================================================
const SAVE_KEY = 'sudoku_saved_game';

function saveGame() {
  if (!gameStarted || solved) return;
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      difficulty:     currentDifficulty,
      board,
      solution,
      given,
      locked,
      notes:          notes.map(row => row.map(s => [...s])), // Set → array
      secondsElapsed,
      hintsUsed,
      mistakes,
    }));
  } catch (_) {}
}

function clearSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch (_) {}
}

function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_) { return null; }
}

// =========================================================
// Game state
// =========================================================
let solution  = [];
let given     = [];    // boolean grid — true = pre-filled clue
let locked    = [];    // boolean grid — true = locked by completed group
let board     = [];    // current values, 0 = empty
let notes     = [];    // Set<number> per cell
let selected  = null;  // [row, col]
let notesMode = false;
let timerInterval   = null;
let secondsElapsed  = 0;
let solved          = false;

// Per-game counters for the stats API
let hintsUsed        = 0;
let mistakes         = 0;
let gameStarted      = false;
let currentDifficulty = 'medium';

// Hint cooldown
const HINT_COOLDOWN_SECONDS = 10;
let lastHintTime       = null;
let hintCooldownInterval = null;

// DOM refs
const boardEl      = document.getElementById('board');
const messageEl    = document.getElementById('message');
const timerEl      = document.getElementById('timer');
const difficultyEl = document.getElementById('difficulty');
const notesBtn     = document.getElementById('notesBtn');
const hintBtn      = document.getElementById('hintBtn');
const numpadEl     = document.getElementById('numpad');

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

function cellEl(r, c) { return boardEl.children[r * SIZE + c]; }

function renderBoard() {
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const el  = cellEl(r, c);
      const val = board[r][c];
      el.className = 'cell';
      el.innerHTML = '';
      if (given[r][c]) {
        el.classList.add('given'); el.textContent = val;
      } else if (locked[r][c]) {
        el.classList.add('locked'); el.textContent = val;
      } else if (val !== 0) {
        el.classList.add('entry'); el.textContent = val;
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
        const sameBox =
          Math.floor(r / BOX) === Math.floor(sr / BOX) &&
          Math.floor(c / BOX) === Math.floor(sc / BOX);
        if (r === sr && c === sc) {
          if (!locked[r][c]) el.classList.add('selected');
        } else if (r === sr || c === sc || sameBox) {
          el.classList.add('peer');
        }
        const selVal = board[sr][sc];
        if (selVal !== 0 && board[r][c] === selVal) el.classList.add('match');
      }
    }
  }
}

// =========================================================
// Number completion
// =========================================================
function countDigitsOnBoard() {
  const counts = new Array(10).fill(0);
  for (let r = 0; r < SIZE; r++)
    for (let c = 0; c < SIZE; c++)
      if (board[r][c] !== 0) counts[board[r][c]]++;
  return counts;
}

function updateNumpadDisabled() {
  const counts = countDigitsOnBoard();
  numpadEl.querySelectorAll('.num-btn').forEach(btn => {
    const num = Number(btn.dataset.num);
    if (num === 0) return;
    const full = counts[num] >= SIZE;
    btn.disabled = full;
    btn.classList.toggle('num-complete', full);
  });
}

// =========================================================
// Row / col / box completion flash
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
  for (const [r, c] of cells) locked[r][c] = true;
}

function checkGroupCompletions(prevBoard) {
  const conflicts = findConflicts();
  if (conflicts.size > 0) return;
  for (let r = 0; r < SIZE; r++) {
    const cells = [...Array(SIZE)].map((_, c) => [r, c]);
    const nowFull = cells.every(([row, col]) => board[row][col] !== 0);
    const wasFull = cells.every(([row, col]) => prevBoard[row][col] !== 0);
    if (nowFull && !wasFull) { flashCells(cells); lockCells(cells); }
  }
  for (let c = 0; c < SIZE; c++) {
    const cells = [...Array(SIZE)].map((_, r) => [r, c]);
    const nowFull = cells.every(([row, col]) => board[row][col] !== 0);
    const wasFull = cells.every(([row, col]) => prevBoard[row][col] !== 0);
    if (nowFull && !wasFull) { flashCells(cells); lockCells(cells); }
  }
  for (let br = 0; br < SIZE; br += BOX) {
    for (let bc = 0; bc < SIZE; bc += BOX) {
      const cells = [];
      for (let r = br; r < br + BOX; r++)
        for (let c = bc; c < bc + BOX; c++) cells.push([r, c]);
      const nowFull = cells.every(([row, col]) => board[row][col] !== 0);
      const wasFull = cells.every(([row, col]) => prevBoard[row][col] !== 0);
      if (nowFull && !wasFull) { flashCells(cells); lockCells(cells); }
    }
  }
  renderBoard();
}

// =========================================================
// Hint cooldown
// =========================================================
function updateHintButton() {
  if (!lastHintTime) {
    hintBtn.disabled = false;
    hintBtn.querySelector('.tool-label').textContent = 'Hint';
    return;
  }
  const elapsed   = (Date.now() - lastHintTime) / 1000;
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
    const elapsed   = (Date.now() - lastHintTime) / 1000;
    const remaining = Math.ceil(HINT_COOLDOWN_SECONDS - elapsed);
    if (remaining <= 0) {
      clearInterval(hintCooldownInterval); hintCooldownInterval = null;
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
  const markGroup = cells => {
    const seen = {};
    for (const [r, c] of cells) {
      const v = board[r][c];
      if (v === 0) continue;
      (seen[v] ||= []).push([r, c]);
    }
    for (const group of Object.values(seen))
      if (group.length > 1) for (const [r, c] of group) conflicts.add(`${r},${c}`);
  };
  for (let i = 0; i < SIZE; i++) {
    markGroup([...Array(SIZE)].map((_, c) => [i, c]));
    markGroup([...Array(SIZE)].map((_, r) => [r, i]));
  }
  for (let br = 0; br < SIZE; br += BOX) {
    for (let bc = 0; bc < SIZE; bc += BOX) {
      const cells = [];
      for (let r = br; r < br + BOX; r++)
        for (let c = bc; c < bc + BOX; c++) cells.push([r, c]);
      markGroup(cells);
    }
  }
  return conflicts;
}

function isComplete() {
  for (let r = 0; r < SIZE; r++)
    for (let c = 0; c < SIZE; c++)
      if (board[r][c] === 0) return false;
  return true;
}

function checkWin() {
  if (!isComplete() || findConflicts().size > 0) return;

  solved      = true;
  gameStarted = false;
  clearSave(); // no longer resumable
  stopTimer();

  messageEl.textContent = `Solved in ${formatTime(secondsElapsed)}! 🎉`;
  messageEl.classList.add('win');
  if (tg) tg.HapticFeedback?.notificationOccurred('success');

  apiPost('/api/stats/win', {
    difficulty:   currentDifficulty,
    time_seconds: secondsElapsed,
    hints_used:   hintsUsed,
    mistakes,
  }).then(renderStats);
}

// =========================================================
// Input handling
// =========================================================
function selectCell(r, c) { selected = [r, c]; applyHighlights(); }

function setCellValue(num) {
  if (!selected || solved) return;
  const [r, c] = selected;
  if (given[r][c] || locked[r][c]) return;

  const prevBoard = board.map(row => [...row]);

  if (notesMode) {
    if (num === 0) notes[r][c].clear();
    else if (notes[r][c].has(num)) notes[r][c].delete(num);
    else notes[r][c].add(num);
  } else {
    const wasWrong = prevBoard[r][c] !== 0 && prevBoard[r][c] !== solution[r][c];
    const isWrong  = num !== 0 && num !== solution[r][c];
    if (isWrong && !wasWrong) mistakes++;

    board[r][c] = board[r][c] === num ? 0 : num;
    if (board[r][c] !== 0) notes[r][c].clear();
  }

  renderBoard();
  saveGame();

  if (!notesMode) {
    checkGroupCompletions(prevBoard);
    if (board[r][c] !== 0) clearNotesForPlacedDigit(r, c, board[r][c]);
  }
  checkWin();
}

function clearNotesForPlacedDigit(row, col, digit) {
  const boxR = Math.floor(row / BOX) * BOX;
  const boxC = Math.floor(col / BOX) * BOX;
  for (let i = 0; i < SIZE; i++) {
    notes[row][i].delete(digit);
    notes[i][col].delete(digit);
  }
  for (let r = boxR; r < boxR + BOX; r++)
    for (let c = boxC; c < boxC + BOX; c++) notes[r][c].delete(digit);
}

function handleKeydown(e) {
  if (statsSheet.classList.contains('open')) return; // don't interfere with sheet
  if (!selected) return;
  const [r, c] = selected;
  if (e.key >= '1' && e.key <= '9') setCellValue(Number(e.key));
  else if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '0') setCellValue(0);
  else if (e.key === 'ArrowUp')    selectCell(Math.max(0, r - 1), c);
  else if (e.key === 'ArrowDown')  selectCell(Math.min(SIZE - 1, r + 1), c);
  else if (e.key === 'ArrowLeft')  selectCell(r, Math.max(0, c - 1));
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
  timerEl.textContent = formatTime(0);
  timerInterval = setInterval(() => {
    secondsElapsed++;
    timerEl.textContent = formatTime(secondsElapsed);
    saveGame(); // keep localStorage in sync every second
  }, 1000);
}

function stopTimer() {
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = null;
}

// =========================================================
// Game lifecycle
// =========================================================

/** Restore a saved game into live state without hitting the server. */
function resumeGame(state) {
  currentDifficulty = state.difficulty;
  difficultyEl.value = state.difficulty;

  solution = state.solution;
  board    = state.board;
  given    = state.given;
  locked   = state.locked;
  notes    = state.notes.map(row => row.map(arr => new Set(arr)));

  secondsElapsed = state.secondsElapsed ?? 0;
  hintsUsed      = state.hintsUsed      ?? 0;
  mistakes       = state.mistakes       ?? 0;
  gameStarted    = true;
  solved         = false;
  selected       = null;
  notesMode      = false;

  lastHintTime = null;
  if (hintCooldownInterval) { clearInterval(hintCooldownInterval); hintCooldownInterval = null; }
  notesBtn.setAttribute('aria-pressed', 'false');

  messageEl.textContent = '';
  messageEl.classList.remove('win');

  renderBoard();

  // Resume timer from where it left off
  stopTimer();
  timerEl.textContent = formatTime(secondsElapsed);
  timerInterval = setInterval(() => {
    secondsElapsed++;
    timerEl.textContent = formatTime(secondsElapsed);
    saveGame();
  }, 1000);
}

function newGame() {
  // If a puzzle was in progress, record it as abandoned (use saved difficulty)
  if (gameStarted && !solved) {
    apiPost('/api/stats/abandon', { difficulty: currentDifficulty });
  }

  // Pick a random difficulty for the new game
  const difficulty = DIFFICULTIES[Math.floor(Math.random() * DIFFICULTIES.length)];
  currentDifficulty = difficulty;
  difficultyEl.value = difficulty;

  const { puzzle, solution: sol } = generatePuzzle(difficulty);
  solution = sol;
  board    = puzzle.map(row => [...row]);
  given    = puzzle.map(row => row.map(v => v !== 0));
  locked   = puzzle.map(() => new Array(SIZE).fill(false));
  notes    = puzzle.map(() => Array.from({ length: SIZE }, () => new Set()));
  selected  = null;
  solved    = false;
  hintsUsed = 0;
  mistakes  = 0;
  gameStarted = true;
  notesMode   = false;
  notesBtn.setAttribute('aria-pressed', 'false');

  lastHintTime = null;
  if (hintCooldownInterval) { clearInterval(hintCooldownInterval); hintCooldownInterval = null; }

  messageEl.textContent = '';
  messageEl.classList.remove('win');

  clearSave();
  renderBoard();
  startTimer();

  apiPost('/api/stats/game-start', { difficulty }).then(renderStats);
}

function giveHint() {
  if (solved) return;
  if (lastHintTime && (Date.now() - lastHintTime) / 1000 < HINT_COOLDOWN_SECONDS) return;

  let target = selected;
  if (!target || board[target[0]][target[1]] !== 0) {
    outer: for (let r = 0; r < SIZE; r++)
      for (let c = 0; c < SIZE; c++)
        if (board[r][c] === 0) { target = [r, c]; break outer; }
  }
  if (!target) return;

  const prevBoard = board.map(row => [...row]);
  const [r, c]    = target;
  board[r][c]     = solution[r][c];
  notes[r][c].clear();
  clearNotesForPlacedDigit(r, c, board[r][c]);
  selected = [r, c];
  hintsUsed++;

  renderBoard();
  saveGame();
  checkGroupCompletions(prevBoard);
  checkWin();
  startHintCooldown();
}

// =========================================================
// Wiring
// =========================================================
buildBoardDom();

numpadEl.addEventListener('click', e => {
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

// Difficulty dropdown no longer starts a new game — it's just informational
// (new game picks a random difficulty anyway, but the user can override here)
difficultyEl.addEventListener('change', () => {
  // If a game is in progress, apply the new difficulty to the current game's
  // tracking only — don't restart. User must press New Game to get a new puzzle.
  currentDifficulty = difficultyEl.value;
});

document.addEventListener('keydown', handleKeydown);

// Save on tab/app close
document.addEventListener('visibilitychange', () => { if (document.hidden) saveGame(); });
window.addEventListener('pagehide', saveGame);

// =========================================================
// Stats sheet
// =========================================================
const statsSheet    = document.getElementById('statsSheet');
const statsBackdrop = document.getElementById('statsBackdrop');

function openStats() {
  document.querySelectorAll('.diff-card').forEach(card => {
    card.classList.toggle('open', card.dataset.diff === currentDifficulty);
  });
  statsSheet.classList.add('open');
  statsSheet.setAttribute('aria-hidden', 'false');
  statsBackdrop.classList.add('open');
  statsBackdrop.setAttribute('aria-hidden', 'false');

  const initData = getInitData();
  if (initData) {
    fetch(`${BASE_URL}/api/stats?init_data=${encodeURIComponent(initData)}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) renderStats(data); })
      .catch(e => console.warn('Stats fetch error:', e));
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

document.querySelectorAll('.diff-card-header').forEach(header => {
  header.addEventListener('click', () => header.closest('.diff-card').classList.toggle('open'));
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && statsSheet.classList.contains('open')) closeStats();
});

// =========================================================
// Resume banner
// =========================================================
const resumeBanner  = document.getElementById('resumeBanner');
const resumeBtn     = document.getElementById('resumeBtn');
const newGameFromBannerBtn = document.getElementById('newGameFromBannerBtn');

function showResumeBanner(state) {
  const mins = Math.floor(state.secondsElapsed / 60);
  const secs = (state.secondsElapsed % 60).toString().padStart(2, '0');
  document.getElementById('resumeInfo').textContent =
    `${state.difficulty.charAt(0).toUpperCase() + state.difficulty.slice(1)} · ${mins}:${secs} elapsed`;
  resumeBanner.hidden = false;
}

resumeBtn.addEventListener('click', () => {
  const state = loadSave();
  if (state) resumeGame(state);
  resumeBanner.hidden = true;
});

newGameFromBannerBtn.addEventListener('click', () => {
  clearSave();
  resumeBanner.hidden = true;
  newGame();
});

// =========================================================
// Boot
// =========================================================
const savedGame = loadSave();
if (savedGame) {
  // Show resume banner — don't auto-start anything yet
  showResumeBanner(savedGame);
  // Still render a blank board so the UI isn't empty while the banner shows
  resumeGame(savedGame);
  stopTimer(); // pause — only resume when user taps Resume
  timerEl.textContent = formatTime(savedGame.secondsElapsed ?? 0);
} else {
  newGame();
}
