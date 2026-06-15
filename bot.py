"""
Telegram bot entry point.

Responsibilities:
- /start command -> sends a button that opens the Sudoku Mini App
- Sets a persistent "Play Sudoku" menu button next to the chat input
- (Optional) handles data sent back from the Mini App via Telegram.WebApp.sendData()

Run:
    python bot.py
"""

import logging
import os

from dotenv import load_dotenv
from telegram import (
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    MenuButtonWebApp,
    Update,
    WebAppInfo,
)
from telegram.ext import Application, CommandHandler, ContextTypes, MessageHandler, filters

load_dotenv()

BOT_TOKEN = os.getenv("BOT_TOKEN")
WEBAPP_URL = os.getenv("WEBAPP_URL")

logging.basicConfig(
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    level=logging.INFO,
)
logger = logging.getLogger(__name__)


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Send a welcome message with a button that launches the Sudoku Mini App."""
    keyboard = InlineKeyboardMarkup(
        [[InlineKeyboardButton("🧩 Play Sudoku", web_app=WebAppInfo(url=WEBAPP_URL))]]
    )
    await update.message.reply_text(
        "Welcome to Sudoku!\n\nTap the button below to open the puzzle.",
        reply_markup=keyboard,
    )


async def help_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    await update.message.reply_text(
        "/start - Open the Sudoku Mini App\n"
        "/help - Show this message"
    )


async def on_webapp_data(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """
    Triggered if the Mini App calls Telegram.WebApp.sendData(...).
    Useful for reporting results (e.g. "solved in 04:32") back to the chat.
    """
    data = update.effective_message.web_app_data.data
    logger.info("Received web_app_data: %s", data)
    await update.effective_message.reply_text(f"Got it! Result: {data}")


async def post_init(application: Application) -> None:
    """Register a persistent menu button that opens the Mini App directly."""
    await application.bot.set_chat_menu_button(
        menu_button=MenuButtonWebApp(text="Play Sudoku", web_app=WebAppInfo(url=WEBAPP_URL))
    )


def main() -> None:
    if not BOT_TOKEN:
        raise RuntimeError("BOT_TOKEN is not set. Copy .env.example to .env and fill it in.")
    if not WEBAPP_URL:
        raise RuntimeError("WEBAPP_URL is not set. Copy .env.example to .env and fill it in.")

    application = Application.builder().token(BOT_TOKEN).post_init(post_init).build()

    application.add_handler(CommandHandler("start", start))
    application.add_handler(CommandHandler("help", help_command))
    application.add_handler(MessageHandler(filters.StatusUpdate.WEB_APP_DATA, on_webapp_data))

    logger.info("Bot started. Press Ctrl+C to stop.")
    application.run_polling(allowed_updates=Update.ALL_TYPES)


if __name__ == "__main__":
    main()
