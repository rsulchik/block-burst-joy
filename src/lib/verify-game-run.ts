import {
  applyClears,
  canPlace,
  clearScore,
  createSeededRandom,
  emptyBoard,
  findClears,
  hasAnyMove,
  place,
  randomPieceSet,
  type Board,
  type Piece,
} from "./blast.ts";

export type GameMove = {
  slot: number;
  row: number;
  col: number;
};

export type VerifiedGameResult = {
  score: number;
  gameOver: boolean;
};

export const MAX_VERIFIED_MOVES = 5000;

/** Replays a run from its server-issued seed; never trusts a client score. */
export function verifyGameRun(seed: string, moves: readonly GameMove[]): VerifiedGameResult {
  if (!seed || seed.length > 128) throw new Error("Invalid run seed");
  if (moves.length === 0 || moves.length > MAX_VERIFIED_MOVES) {
    throw new Error("Invalid move count");
  }

  const random = createSeededRandom(seed);
  let board: Board = emptyBoard();
  let pieces: (Piece | null)[] = randomPieceSet(3, 0, null, random);
  let score = 0;

  for (let index = 0; index < moves.length; index++) {
    const move = moves[index];
    if (
      !move ||
      !Number.isInteger(move.slot) ||
      move.slot < 0 ||
      move.slot >= pieces.length ||
      !Number.isInteger(move.row) ||
      !Number.isInteger(move.col)
    ) {
      throw new Error("Invalid move");
    }

    const piece = pieces[move.slot];
    if (!piece || !canPlace(board, piece.shape, move.row, move.col)) {
      throw new Error("Illegal move");
    }

    board = place(board, piece, move.row, move.col);
    const { rows, cols } = findClears(board);
    const clearedLines = rows.length + cols.length;
    score += piece.shape.cells.length + clearScore(clearedLines, score);
    if (clearedLines > 0) board = applyClears(board, rows, cols);

    const remaining = pieces.map((candidate, slot) => (slot === move.slot ? null : candidate));
    pieces = remaining.every((candidate) => candidate === null)
      ? randomPieceSet(3, score, board, random)
      : remaining;

    const gameOver = !hasAnyMove(board, pieces);
    if (gameOver && index !== moves.length - 1) {
      throw new Error("Moves continue after game over");
    }
  }

  return { score, gameOver: !hasAnyMove(board, pieces) };
}
