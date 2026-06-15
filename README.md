# Sudoku Telegram Bot + Mini App

A minimal boilerplate for a Telegram bot that launches a Sudoku **Mini App**
(Telegram Web App). The Mini App generates puzzles client-side and is fully
playable: cell selection, number pad, pencil-mark notes, conflict
highlighting, timer, hints and win detection.

## Project structure

```
sudoku-telegram-bot/
├── bot.py              # Telegram bot (python-telegram-bot v21)
├── sudoku.py           # Puzzle generator/validator (Python, for server-side use)
├── requirements.txt
├── .env.example
└── webapp/             # The Mini App (static site)
    ├── index.html
    ├── style.css
    └── script.js
```

## 1. Create the bot

1. Message [@BotFather](https://t.me/BotFather) on Telegram, run `/newbot`,
   and copy the bot token.
2. Copy `.env.example` to `.env` and set `BOT_TOKEN`.

## 2. Host the Mini App

Telegram Mini Apps **must** be served over HTTPS. For local development you
can use a tunnel:

```bash
# from the webapp/ folder
python -m http.server 8000

# in another terminal
ngrok http 8000
```

Take the `https://...ngrok-free.app` URL ngrok gives you and put it in `.env`
as `WEBAPP_URL` (keep the trailing slash, e.g. `https://xxxx.ngrok-free.app/`).

For production, deploy the `webapp/` folder to any static host (GitHub Pages,
Vercel, Netlify, Cloudflare Pages, your own server with HTTPS, etc.) and use
that URL instead.

## 3. Install dependencies & run the bot

```bash
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python bot.py
```

## 4. Try it

In Telegram, open a chat with your bot and send `/start`. Tap **"🧩 Play
Sudoku"** to open the Mini App, or use the persistent menu button next to the
message input.

## How it works

- **`bot.py`** sends an inline button with `web_app=WebAppInfo(url=...)`,
  registers a chat menu button, and (optionally) listens for data sent back
  from the Mini App via `Telegram.WebApp.sendData(...)`.
- **`webapp/script.js`** contains a self-contained Sudoku engine (generation
  via the classic shuffled-pattern technique, conflict detection, notes,
  timer, hints). It calls `Telegram.WebApp.ready()` / `expand()` on load and
  themes the Telegram header/background to match the app.
- **`sudoku.py`** is the Python equivalent of the generator, useful if you'd
  rather generate puzzles server-side (e.g. expose an API endpoint, or send a
  daily puzzle via the bot) and pass them to the Mini App through
  `tg.initDataUnsafe` or a fetch call.

## Ideas to extend this boilerplate

- Persist progress/leaderboards with a small backend (FastAPI/Flask) +
  database, authenticating requests using Telegram's `initData` validation.
- Add a "daily puzzle" sent automatically via a scheduled job.
- Send `Telegram.WebApp.sendData()` on win to post results/streaks back into
  the chat.
- Add light/dark theming based on `Telegram.WebApp.colorScheme`.
