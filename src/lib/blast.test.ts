import { describe, expect, it } from "vitest";
import {
  applyClears,
  canPlace,
  canPlaceAnywhere,
  createSeededRandom,
  emptyBoard,
  findClears,
  hasAnyMove,
  place,
  randomPieceSet,
  type Board,
  SHAPES,
  SIZE,
} from "./blast";

describe("block board rules", () => {
  it("places a piece only when every occupied cell is in bounds and empty", () => {
    const board = emptyBoard();
    const [piece] = randomPieceSet();
    expect(piece).toBeDefined();
    expect(canPlace(board, piece!.shape, 0, 0)).toBe(true);

    const occupied = place(board, piece!, 0, 0);
    expect(canPlace(occupied, piece!.shape, 0, 0)).toBe(false);
    expect(canPlace(board, piece!.shape, -1, 0)).toBe(false);
  });

  it("matches an exhaustive legal-placement scan for every shape", () => {
    const boards = [
      emptyBoard(),
      Array.from({ length: SIZE }, () => Array<number | null>(SIZE).fill(1)),
    ];
    boards[1]![SIZE - 1]![SIZE - 1] = null;

    for (const board of boards) {
      for (const shape of SHAPES) {
        let exhaustiveResult = false;
        for (let row = 0; row < SIZE && !exhaustiveResult; row++) {
          for (let col = 0; col < SIZE && !exhaustiveResult; col++) {
            exhaustiveResult = canPlace(board, shape, row, col);
          }
        }
        expect(canPlaceAnywhere(board, shape)).toBe(exhaustiveResult);
      }
    }
  });

  it("clears complete rows and columns", () => {
    const board = emptyBoard();
    board[0] = [0, 1, 2, 3, 4, 5, 6, null];
    const single = {
      id: "single",
      shape: { cells: [[0, 0] as [number, number]], w: 1, h: 1 },
      color: 0,
    };
    const filled = place(board, single, 0, 7);
    const clears = findClears(filled);

    expect(clears.rows).toEqual([0]);
    expect(applyClears(filled, clears.rows, clears.cols)[0]).toEqual(Array(8).fill(null));
  });

  it("generates repeatable verified pieces from the same seed", () => {
    const first = randomPieceSet(3, 0, null, createSeededRandom("seed-one"));
    const second = randomPieceSet(3, 0, null, createSeededRandom("seed-one"));
    expect(second).toEqual(first);
  });

  it("keeps at least one possible move when a board has free space", () => {
    const board: Board = Array.from({ length: 8 }, () => Array<number | null>(8).fill(1));
    board[7]![7] = null;
    const pieces = randomPieceSet(3, 400, board, createSeededRandom("near-full"));
    expect(hasAnyMove(board, pieces)).toBe(true);
  });
});
