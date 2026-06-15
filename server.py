"""
server.py — FastAPI backend for the Sudoku Telegram Mini App.

Run with:
    uvicorn server:app --reload --port 8000

Schema
------
stats (user_id PK)
    — global cross-difficulty totals: played, won, abandoned,
      current_streak, best_streak

difficulty_stats (user_id, difficulty PK)
    — everything tracked per difficulty:
      played, won, abandoned,
      total_time, best_time, worst_time,   ← time only makes sense per-difficulty
      total_hints, total_mistakes,
      current_streak, best_streak
"""

import hashlib
import hmac
import json
import sqlite3
import time
from contextlib import contextmanager
from urllib.parse import parse_qsl, unquote

from dotenv import load_dotenv
import os

from fastapi import FastAPI, HTTPException, Query
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
load_dotenv()
BOT_TOKEN: str = os.environ["BOT_TOKEN"]

DB_PATH = "stats.db"
VALID_DIFFICULTIES = {"easy", "medium", "hard", "expert"}

# ---------------------------------------------------------------------------
# Database helpers
# ---------------------------------------------------------------------------

@contextmanager
def get_db():
    """Yield a SQLite connection and commit/close it automatically."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db() -> None:
    """Create tables if they don't already exist."""
    with get_db() as conn:
        # Global cross-difficulty counters only
        conn.execute("""
            CREATE TABLE IF NOT EXISTS stats (
                user_id         INTEGER PRIMARY KEY,
                username        TEXT,
                played          INTEGER DEFAULT 0,
                won             INTEGER DEFAULT 0,
                abandoned       INTEGER DEFAULT 0,
                current_streak  INTEGER DEFAULT 0,
                best_streak     INTEGER DEFAULT 0
            )
        """)

        # Full per-difficulty breakdown
        conn.execute("""
            CREATE TABLE IF NOT EXISTS difficulty_stats (
                user_id         INTEGER NOT NULL,
                difficulty      TEXT    NOT NULL,
                played          INTEGER DEFAULT 0,
                won             INTEGER DEFAULT 0,
                abandoned       INTEGER DEFAULT 0,
                total_time      INTEGER DEFAULT 0,
                best_time       INTEGER,
                worst_time      INTEGER,
                total_hints     INTEGER DEFAULT 0,
                total_mistakes  INTEGER DEFAULT 0,
                current_streak  INTEGER DEFAULT 0,
                best_streak     INTEGER DEFAULT 0,
                PRIMARY KEY (user_id, difficulty),
                FOREIGN KEY (user_id) REFERENCES stats(user_id)
            )
        """)


def ensure_row(conn: sqlite3.Connection, user_id: int, username: str) -> None:
    conn.execute(
        "INSERT OR IGNORE INTO stats (user_id, username) VALUES (?, ?)",
        (user_id, username),
    )


def ensure_difficulty_row(conn: sqlite3.Connection, user_id: int, difficulty: str) -> None:
    conn.execute(
        "INSERT OR IGNORE INTO difficulty_stats (user_id, difficulty) VALUES (?, ?)",
        (user_id, difficulty),
    )


def fetch_stats(conn: sqlite3.Connection, user_id: int) -> dict:
    """Return the full stats object the frontend expects."""
    g = conn.execute("SELECT * FROM stats WHERE user_id = ?", (user_id,)).fetchone()

    d_rows = conn.execute(
        "SELECT * FROM difficulty_stats WHERE user_id = ?", (user_id,)
    ).fetchall()

    # Build per-difficulty dict — every difficulty always present
    by_difficulty: dict = {}
    for d in VALID_DIFFICULTIES:
        by_difficulty[d] = {
            "played":        0,
            "won":           0,
            "abandoned":     0,
            "totalTime":     0,
            "bestTime":      None,
            "worstTime":     None,
            "avgTime":       None,
            "totalHints":    0,
            "totalMistakes": 0,
            "currentStreak": 0,
            "bestStreak":    0,
        }
    for row in d_rows:
        d    = row["difficulty"]
        wc   = row["won"]
        tt   = row["total_time"]
        by_difficulty[d] = {
            "played":        row["played"],
            "won":           wc,
            "abandoned":     row["abandoned"],
            "totalTime":     tt,
            "bestTime":      row["best_time"],
            "worstTime":     row["worst_time"],
            "avgTime":       round(tt / wc) if wc else None,
            "totalHints":    row["total_hints"],
            "totalMistakes": row["total_mistakes"],
            "currentStreak": row["current_streak"],
            "bestStreak":    row["best_streak"],
        }

    # Global totals (derived from difficulty_stats so they stay consistent,
    # but we also keep the global streak which spans all difficulties)
    if g is None:
        global_stats = {
            "played":        0,
            "won":           0,
            "abandoned":     0,
            "currentStreak": 0,
            "bestStreak":    0,
        }
    else:
        global_stats = {
            "played":        g["played"],
            "won":           g["won"],
            "abandoned":     g["abandoned"],
            "currentStreak": g["current_streak"],
            "bestStreak":    g["best_streak"],
        }

    return {"global": global_stats, "byDifficulty": by_difficulty}

# ---------------------------------------------------------------------------
# Telegram initData validation
# ---------------------------------------------------------------------------

def validate_init_data(init_data: str) -> dict:
    """
    Validate Telegram WebApp initData per the official spec.
    Returns the parsed user dict or raises HTTPException(401).
    """
    params = dict(parse_qsl(init_data, keep_blank_values=True))

    received_hash = params.pop("hash", None)
    if not received_hash:
        raise HTTPException(status_code=401, detail="Missing hash in initData")

    data_check_string = "\n".join(f"{k}={v}" for k, v in sorted(params.items()))

    secret_key = hmac.new(b"WebAppData", BOT_TOKEN.encode(), hashlib.sha256).digest()
    computed_hash = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()

    if not hmac.compare_digest(computed_hash, received_hash):
        raise HTTPException(status_code=401, detail="Invalid initData signature")

    auth_date = params.get("auth_date")
    if auth_date and (time.time() - int(auth_date)) > 86400:
        raise HTTPException(status_code=401, detail="initData has expired")

    user_raw = params.get("user")
    if not user_raw:
        raise HTTPException(status_code=401, detail="No user in initData")

    try:
        return json.loads(unquote(user_raw))
    except json.JSONDecodeError:
        raise HTTPException(status_code=401, detail="Malformed user field in initData")


def validate_difficulty(difficulty: str) -> str:
    d = difficulty.lower().strip()
    if d not in VALID_DIFFICULTIES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid difficulty '{difficulty}'. Must be one of: {sorted(VALID_DIFFICULTIES)}",
        )
    return d

# ---------------------------------------------------------------------------
# Pydantic request bodies
# ---------------------------------------------------------------------------

class GameStartRequest(BaseModel):
    init_data:  str
    difficulty: str


class WinRequest(BaseModel):
    init_data:    str
    difficulty:   str
    time_seconds: int
    hints_used:   int
    mistakes:     int


class AbandonRequest(BaseModel):
    init_data:  str
    difficulty: str

# ---------------------------------------------------------------------------
# App + startup
# ---------------------------------------------------------------------------

app = FastAPI(title="Sudoku Stats API")


@app.on_event("startup")
def on_startup():
    init_db()

# ---------------------------------------------------------------------------
# API routes
# ---------------------------------------------------------------------------

@app.get("/api/stats")
def get_stats(init_data: str = Query(...)):
    user = validate_init_data(init_data)
    with get_db() as conn:
        return fetch_stats(conn, user["id"])


@app.post("/api/stats/game-start")
def game_start(body: GameStartRequest):
    """Increment played (global + per-difficulty)."""
    user       = validate_init_data(body.init_data)
    difficulty = validate_difficulty(body.difficulty)
    user_id    = user["id"]
    username   = user.get("username") or user.get("first_name", "")

    with get_db() as conn:
        ensure_row(conn, user_id, username)
        ensure_difficulty_row(conn, user_id, difficulty)

        conn.execute(
            "UPDATE stats SET played = played + 1 WHERE user_id = ?",
            (user_id,),
        )
        conn.execute(
            "UPDATE difficulty_stats SET played = played + 1 WHERE user_id = ? AND difficulty = ?",
            (user_id, difficulty),
        )
        return fetch_stats(conn, user_id)


@app.post("/api/stats/win")
def record_win(body: WinRequest):
    """Record a completed puzzle — updates all per-difficulty and global counters."""
    user       = validate_init_data(body.init_data)
    difficulty = validate_difficulty(body.difficulty)
    user_id    = user["id"]
    username   = user.get("username") or user.get("first_name", "")
    t          = body.time_seconds

    with get_db() as conn:
        ensure_row(conn, user_id, username)
        ensure_difficulty_row(conn, user_id, difficulty)

        # Fetch current per-difficulty values needed for comparison
        d_row = conn.execute(
            "SELECT best_time, worst_time, current_streak, best_streak "
            "FROM difficulty_stats WHERE user_id = ? AND difficulty = ?",
            (user_id, difficulty),
        ).fetchone()

        new_best      = min(d_row["best_time"],  t) if d_row["best_time"]  is not None else t
        new_worst     = max(d_row["worst_time"], t) if d_row["worst_time"] is not None else t
        new_d_streak  = (d_row["current_streak"] or 0) + 1
        new_d_best_s  = max(d_row["best_streak"] or 0, new_d_streak)

        conn.execute(
            """
            UPDATE difficulty_stats SET
                won            = won + 1,
                total_time     = total_time + ?,
                best_time      = ?,
                worst_time     = ?,
                total_hints    = total_hints    + ?,
                total_mistakes = total_mistakes + ?,
                current_streak = ?,
                best_streak    = ?
            WHERE user_id = ? AND difficulty = ?
            """,
            (t, new_best, new_worst,
             body.hints_used, body.mistakes,
             new_d_streak, new_d_best_s,
             user_id, difficulty),
        )

        # Global streak spans all difficulties
        g_row = conn.execute(
            "SELECT current_streak, best_streak FROM stats WHERE user_id = ?",
            (user_id,),
        ).fetchone()
        new_g_streak = (g_row["current_streak"] or 0) + 1
        new_g_best_s = max(g_row["best_streak"] or 0, new_g_streak)

        conn.execute(
            """
            UPDATE stats SET
                won            = won + 1,
                current_streak = ?,
                best_streak    = ?
            WHERE user_id = ?
            """,
            (new_g_streak, new_g_best_s, user_id),
        )

        return fetch_stats(conn, user_id)


@app.post("/api/stats/abandon")
def record_abandon(body: AbandonRequest):
    """Record an abandoned puzzle — resets current streaks."""
    user       = validate_init_data(body.init_data)
    difficulty = validate_difficulty(body.difficulty)
    user_id    = user["id"]
    username   = user.get("username") or user.get("first_name", "")

    with get_db() as conn:
        ensure_row(conn, user_id, username)
        ensure_difficulty_row(conn, user_id, difficulty)

        conn.execute(
            """
            UPDATE difficulty_stats
            SET abandoned = abandoned + 1, current_streak = 0
            WHERE user_id = ? AND difficulty = ?
            """,
            (user_id, difficulty),
        )
        conn.execute(
            "UPDATE stats SET abandoned = abandoned + 1, current_streak = 0 WHERE user_id = ?",
            (user_id,),
        )

        return fetch_stats(conn, user_id)

# ---------------------------------------------------------------------------
# Static files — mounted LAST so /api/* routes take priority
# ---------------------------------------------------------------------------
app.mount("/", StaticFiles(directory="webapp", html=True), name="webapp")
