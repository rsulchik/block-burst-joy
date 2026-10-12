import { describe, expect, it } from "vitest";
import { createSeededRandom, randomPieceSet } from "./blast";
import { verifyGameRun } from "./verify-game-run";

describe("verified game replay", () => {
  it("recomputes a legal score from the issued seed and moves", () => {
    const seed = "test-run-seed";
    const firstPiece = randomPieceSet(3, 0, null, createSeededRandom(seed))[0]!;
    const result = verifyGameRun(seed, [{ slot: 0, row: 0, col: 0 }]);

    expect(result).toEqual({ score: firstPiece.shape.cells.length, gameOver: false });
  });

  it("rejects an out-of-range slot and an illegal placement", () => {
    expect(() => verifyGameRun("test-run-seed", [{ slot: 3, row: 0, col: 0 }])).toThrow(
      "Invalid move",
    );
    expect(() => verifyGameRun("test-run-seed", [{ slot: 0, row: -1, col: 0 }])).toThrow(
      "Illegal move",
    );
  });

  it("rejects empty or excessively long replays", () => {
    expect(() => verifyGameRun("test-run-seed", [])).toThrow("Invalid move count");
    const moves = Array.from({ length: 5001 }, () => ({ slot: 0, row: 0, col: 0 }));
    expect(() => verifyGameRun("test-run-seed", moves)).toThrow("Invalid move count");
  });
});
