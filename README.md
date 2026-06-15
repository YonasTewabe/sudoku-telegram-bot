# Sudoku Telegram Bot + Mini App

A Telegram bot that launches a fully-featured Sudoku **Mini App** (Telegram Web App). Puzzles are generated client-side, stats are persisted server-side via a FastAPI backend, and the whole thing is served as a single unified app.

![Dark theme UI with electric indigo accent](https://img.shields.io/badge/UI-Dark%20Theme-6c63ff?style=flat-square) ![Python](https://img.shields.io/badge/Python-3.10%2B-blue?style=flat-square) ![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009688?style=flat-square)

## Features

- **4 difficulty levels** — Easy, Medium, Hard, Expert (random on each new game)
- **Pencil-mark notes** — toggle notes mode to candidate-fill cells
- **Conflict highlighting** — invalid rows/cols/boxes are flagged in real time
- **Group completion flash** — rows, columns, and boxes light up when completed
- **Hints** with a 10-second cooldown per hint
- **Game persistence** — in-progress games survive app close via `localStorage`, with a resume banner on relaunch
- **Per-user stats** tracked server-side: games played/won/abandoned, best/avg/worst times, streaks, hints used, mistakes — broken down per difficulty and globally
- **Modern dark UI** — electric indigo accent, glassmorphism stats sheet, SVG icons, smooth transitions

## Project structure

```
sudoku-telegram-bot/
├── bot.py              # Telegram bot (python-telegram-bot v21)
├── server.py           # FastAPI backend — serves the Mini App + stats API
├── sudoku.py           # Puzzle generator/validator (Python, server-side use)
├── stats.db            # SQLite database (auto-created on first run)
├── requirements.txt
├── .env.example
└── webapp/             # Mini App (static site, served by FastAPI)
    ├── index.html
    ├── style.css
    └── script.js
```

## Setup

### 1. Create the bot

1. Message [@BotFather](https://t.me/BotFather), run `/newbot`, and copy the token.
2. Copy `.env.example` to `.env` and fill in the values:

```env
BOT_TOKEN=123456789:your-telegram-bot-token-here
WEBAPP_URL=https://your-domain.example/
```

### 2. Install dependencies

```bash
python -m venv .venv
# Windows:
.venv\Scripts\activate
# macOS/Linux:
source .venv/bin/activate

pip install -r requirements.txt
```

### 3. Run the server

The FastAPI server serves both the Mini App (static files) and the stats API from a single process:

```bash
uvicorn server:app --reload --port 8000
```

The app will be available at `http://localhost:8000`. Telegram requires HTTPS, so for local development use a tunnel:

```bash
# in a separate terminal
ngrok http 8000
```

Use the `https://...ngrok-free.app` URL as your `WEBAPP_URL` in `.env`.

For production, deploy to any host with HTTPS (Railway, Fly.io, Render, a VPS, etc.) and set `WEBAPP_URL` accordingly.

### 4. Run the bot

```bash
python bot.py
```

### 5. Try it

Open a chat with your bot in Telegram and send `/start`. Tap **"🧩 Play Sudoku"** to launch the Mini App, or use the persistent menu button next to the message input.

## API reference

All endpoints validate Telegram's `initData` signature before processing.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/stats?init_data=...` | Fetch full stats for the authenticated user |
| `POST` | `/api/stats/game-start` | Record a new game started |
| `POST` | `/api/stats/win` | Record a completed puzzle (time, hints, mistakes) |
| `POST` | `/api/stats/abandon` | Record an abandoned game, resets current streak |

`POST` bodies are JSON with `init_data` plus any endpoint-specific fields. See `server.py` for the full Pydantic schemas.

## How it works

**`server.py`** — FastAPI app that:
- Validates every request against Telegram's `initData` HMAC signature
- Persists stats to SQLite (`stats.db`) in two tables: `stats` (global) and `difficulty_stats` (per-difficulty)
- Mounts the `webapp/` directory as static files on `/`, with API routes taking priority

**`bot.py`** — Telegram bot that:
- Sends an inline `WebApp` button pointing at `WEBAPP_URL`
- Registers a persistent chat menu button

**`webapp/script.js`** — Self-contained client engine:
- Puzzle generation via the classic shuffled-pattern technique (no server round-trip)
- Conflict detection, notes, hint system with cooldown, group-completion flash
- Game save/restore via `localStorage`
- Stats calls to the FastAPI backend authenticated via `Telegram.WebApp.initData`

**`sudoku.py`** — Python mirror of the JS generator, useful for server-side puzzle generation (e.g. daily puzzles sent by the bot).

## Ideas to extend

- **Daily puzzle** — generate a fixed seed puzzle and send it via a scheduled job using `python-telegram-bot`'s `JobQueue`
- **Leaderboard** — expose a `/api/leaderboard` endpoint and show a top-N sheet in the Mini App
- **Share result** — call `Telegram.WebApp.sendData()` on win to post a result card back into the chat
- **Themes** — read `Telegram.WebApp.colorScheme` to switch between dark and light palettes
- **Undo** — stack of board states for multi-step undo
