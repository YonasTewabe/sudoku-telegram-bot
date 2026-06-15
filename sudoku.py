"""
Core Sudoku logic: board generation, solving and validation.
Used by bot.py if you want to generate puzzles server-side
(e.g. to send via the bot or an API endpoint for the Mini App).
"""

import random

GRID_SIZE = 9
BOX_SIZE = 3

DIFFICULTY_HOLES = {
    "easy": 35,
    "medium": 45,
    "hard": 52,
    "expert": 58,
}


def _pattern(row: int, col: int) -> int:
    return (BOX_SIZE * (row % BOX_SIZE) + row // BOX_SIZE + col) % GRID_SIZE


def _shuffled(seq):
    seq = list(seq)
    random.shuffle(seq)
    return seq


def generate_full_board() -> list[list[int]]:
    """Generate a complete, valid 9x9 Sudoku solution."""
    base = range(BOX_SIZE)
    rows = [g * BOX_SIZE + r for g in _shuffled(base) for r in _shuffled(base)]
    cols = [g * BOX_SIZE + c for g in _shuffled(base) for c in _shuffled(base)]
    nums = _shuffled(range(1, GRID_SIZE + 1))

    board = [[nums[_pattern(r, c)] for c in cols] for r in rows]
    return board


def generate_puzzle(difficulty: str = "medium") -> tuple[list[list[int]], list[list[int]]]:
    """
    Return (puzzle, solution).
    `puzzle` has `0` for empty cells.
    """
    solution = generate_full_board()
    puzzle = [row[:] for row in solution]

    holes = DIFFICULTY_HOLES.get(difficulty, 45)
    cells = [(r, c) for r in range(GRID_SIZE) for c in range(GRID_SIZE)]
    random.shuffle(cells)

    for r, c in cells[:holes]:
        puzzle[r][c] = 0

    return puzzle, solution


def is_valid_placement(board: list[list[int]], row: int, col: int, num: int) -> bool:
    """Check that placing `num` at (row, col) breaks no Sudoku rule."""
    for i in range(GRID_SIZE):
        if i != col and board[row][i] == num:
            return False
        if i != row and board[i][col] == num:
            return False

    box_r, box_c = (row // BOX_SIZE) * BOX_SIZE, (col // BOX_SIZE) * BOX_SIZE
    for r in range(box_r, box_r + BOX_SIZE):
        for c in range(box_c, box_c + BOX_SIZE):
            if (r, c) != (row, col) and board[r][c] == num:
                return False

    return True


def is_board_complete(board: list[list[int]]) -> bool:
    """True if every cell is filled and every placement is valid."""
    for r in range(GRID_SIZE):
        for c in range(GRID_SIZE):
            val = board[r][c]
            if val == 0:
                return False
            board[r][c] = 0
            valid = is_valid_placement(board, r, c, val)
            board[r][c] = val
            if not valid:
                return False
    return True


if __name__ == "__main__":
    puzzle, solution = generate_puzzle("medium")
    for row in puzzle:
        print(" ".join(str(n) if n else "." for n in row))
