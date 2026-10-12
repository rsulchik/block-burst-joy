export type Cell = number | null; // color index or empty
export type Board = Cell[][];
export const SIZE = 8;

export type Shape = { cells: [number, number][]; w: number; h: number };

const RAW: number[][][] = [
  // одиночные и линии
  [[1]],
  [[1, 1]],
  [[1], [1]],
  [[1, 1, 1]],
  [[1], [1], [1]],
  [[1, 1, 1, 1]],
  [[1], [1], [1], [1]],
  [[1, 1, 1, 1, 1]],
  [[1], [1], [1], [1], [1]],
  // прямоугольники
  [
    [1, 1],
    [1, 1],
  ],
  [
    [1, 1, 1],
    [1, 1, 1],
  ],
  [
    [1, 1],
    [1, 1],
    [1, 1],
  ],
  [
    [1, 1, 1],
    [1, 1, 1],
    [1, 1, 1],
  ],
  // L / J (3 клетки)
  [
    [1, 0],
    [1, 1],
  ],
  [
    [0, 1],
    [1, 1],
  ],
  [
    [1, 1],
    [1, 0],
  ],
  [
    [1, 1],
    [0, 1],
  ],
  // L / J (4-5 клеток)
  [
    [1, 0],
    [1, 0],
    [1, 1],
  ],
  [
    [0, 1],
    [0, 1],
    [1, 1],
  ],
  [
    [1, 1],
    [1, 0],
    [1, 0],
  ],
  [
    [1, 1],
    [0, 1],
    [0, 1],
  ],
  [
    [1, 0, 0],
    [1, 1, 1],
  ],
  [
    [0, 0, 1],
    [1, 1, 1],
  ],
  [
    [1, 1, 1],
    [1, 0, 0],
  ],
  [
    [1, 1, 1],
    [0, 0, 1],
  ],
  // T
  [
    [1, 1, 1],
    [0, 1, 0],
  ],
  [
    [0, 1, 0],
    [1, 1, 1],
  ],
  [
    [1, 0],
    [1, 1],
    [1, 0],
  ],
  [
    [0, 1],
    [1, 1],
    [0, 1],
  ],
  // S / Z
  [
    [1, 1, 0],
    [0, 1, 1],
  ],
  [
    [0, 1, 1],
    [1, 1, 0],
  ],
  [
    [1, 0],
    [1, 1],
    [0, 1],
  ],
  [
    [0, 1],
    [1, 1],
    [1, 0],
  ],
  // крест, углы 3x3, диагонали
  [
    [0, 1, 0],
    [1, 1, 1],
    [0, 1, 0],
  ],
  [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ],
  [
    [0, 0, 1],
    [0, 1, 0],
    [1, 0, 0],
  ],
  [
    [1, 0, 1],
    [1, 1, 1],
  ],
  [
    [1, 1, 1],
    [1, 0, 1],
  ],
  [
    [1, 1, 1],
    [1, 0, 0],
    [1, 0, 0],
  ],
  [
    [1, 1, 1],
    [0, 0, 1],
    [0, 0, 1],
  ],
  [
    [1, 0, 0],
    [1, 0, 0],
    [1, 1, 1],
  ],
  [
    [0, 0, 1],
    [0, 0, 1],
    [1, 1, 1],
  ],
];

export const SHAPES: Shape[] = RAW.map((grid) => {
  const cells: [number, number][] = [];
  grid.forEach((row, r) => row.forEach((v, c) => v && cells.push([r, c])));
  return { cells, w: grid[0]!.length, h: grid.length };
});

export const COLORS = 9;

export type Piece = { id: string; shape: Shape; color: number };

/** 0 = легко, 1 = максимум. Растёт со счётом. */
export function difficultyFromScore(score: number): number {
  if (score <= 0) return 0;
  // ~0.25 @ 200, ~0.5 @ 500, ~0.75 @ 900, ~1 @ 1400+
  return Math.min(1, 1 - Math.exp(-score / 700));
}

/** Насколько фигуру сложно «пристроить» (0–5). */
function shapeAwkwardness(s: Shape): number {
  const n = s.cells.length;
  const area = s.w * s.h;
  const density = n / area;
  let a = 0;
  if (n >= 7) a += 2;
  else if (n >= 5) a += 1;
  if (density < 0.55) a += 2;
  else if (density < 0.8) a += 1;
  if (s.w >= 3 && s.h >= 3) a += 1;
  // длинные линии на забитом поле тоже неудобны
  if ((s.w === 1 || s.h === 1) && n >= 4) a += 1;
  return Math.min(5, a);
}

const AWKWARDNESS = SHAPES.map(shapeAwkwardness);

// Базовые веса: крупные реже.
const BASE_WEIGHTS = SHAPES.map((s) => {
  const n = s.cells.length;
  if (n <= 2) return 3;
  if (n <= 4) return 5;
  if (n <= 6) return 4;
  return 2;
});

function weightsForDifficulty(d: number): number[] {
  return BASE_WEIGHTS.map((base, i) => {
    const awk = AWKWARDNESS[i]!;
    // С ростом d: лёгкие фигуры реже, неудобные — чаще.
    const easyPenalty = awk <= 1 ? 1 - d * 0.65 : 1;
    const hardBoost = 1 + awk * d * 0.85;
    return Math.max(0.35, base * easyPenalty * hardBoost);
  });
}

export type RandomSource = (() => number) & { getState?: () => number };

/** Deterministic PRNG shared with the server-side run verifier. */
export function createSeededRandom(seed: string, state?: number): RandomSource {
  let current = state === undefined ? hashSeed(seed) : state >>> 0;
  const random = (() => {
    current = (current + 0x6d2b79f5) >>> 0;
    let value = current;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  }) as RandomSource;
  random.getState = () => current;
  return random;
}

function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash = Math.imul(hash ^ seed.charCodeAt(i), 16777619);
  }
  return hash >>> 0 || 0x6d2b79f5;
}

function weightedShapeIndex(
  d = 0,
  exclude: Set<number> = new Set(),
  random: RandomSource = Math.random,
): number {
  const weights = weightsForDifficulty(d);
  let total = 0;
  for (let i = 0; i < weights.length; i++) {
    if (!exclude.has(i)) total += weights[i]!;
  }
  if (total <= 0) return 0;
  let x = random() * total;
  for (let i = 0; i < weights.length; i++) {
    if (exclude.has(i)) continue;
    x -= weights[i]!;
    if (x <= 0) return i;
  }
  for (let i = weights.length - 1; i >= 0; i--) if (!exclude.has(i)) return i;
  return weights.length - 1;
}

function starterShapeIndex(
  exclude: Set<number> = new Set(),
  random: RandomSource = Math.random,
): number {
  const easy = SHAPES.map((_, index) => index).filter(
    (index) => !exclude.has(index) && AWKWARDNESS[index]! <= 1,
  );
  const pool =
    easy.length > 0 ? easy : SHAPES.map((_, index) => index).filter((index) => !exclude.has(index));
  return pool[Math.floor(random() * pool.length)]!;
}

function randomId(random: RandomSource = Math.random) {
  return random().toString(36).slice(2);
}

function nextColor(used: Set<number> = new Set(), random: RandomSource = Math.random) {
  let color = Math.floor(random() * COLORS);
  for (let t = 0; t < 20 && used.has(color); t++) {
    color = Math.floor(random() * COLORS);
  }
  used.add(color);
  return color;
}

export function randomPiece(
  exclude: Set<number> = new Set(),
  score = 0,
  random: RandomSource = Math.random,
): Piece {
  const d = difficultyFromScore(score);
  const idx =
    score < 120 ? starterShapeIndex(exclude, random) : weightedShapeIndex(d, exclude, random);
  const color = nextColor(new Set(), random);
  return {
    id: randomId(random),
    shape: SHAPES[idx]!,
    color,
  };
}

function buildRandomSet(count: number, score: number, random: RandomSource): Piece[] {
  const d = difficultyFromScore(score);
  const usedShapes = new Set<number>();
  const usedColors = new Set<number>();
  const out: Piece[] = [];
  for (let i = 0; i < count; i++) {
    const idx =
      score < 120
        ? starterShapeIndex(usedShapes, random)
        : weightedShapeIndex(d, usedShapes, random);
    usedShapes.add(idx);
    out.push({ id: randomId(random), shape: SHAPES[idx]!, color: nextColor(usedColors, random) });
  }
  return out;
}

/** Есть ли хоть одна клетка, куда встанет эта фигура. */
export function canPlaceAnywhere(board: Board, shape: Shape) {
  if (shape.h > SIZE || shape.w > SIZE) return false;
  for (let r = 0; r <= SIZE - shape.h; r++) {
    for (let c = 0; c <= SIZE - shape.w; c++) {
      if (canPlace(board, shape, r, c)) return true;
    }
  }
  return false;
}

function findPlaceableShapeIndex(
  board: Board,
  exclude: Set<number> = new Set(),
  random: RandomSource = Math.random,
): number | null {
  const fitting: number[] = [];
  for (let i = 0; i < SHAPES.length; i++) {
    if (exclude.has(i)) continue;
    if (canPlaceAnywhere(board, SHAPES[i]!)) fitting.push(i);
  }
  if (!fitting.length) return null;
  // Предпочитаем более «простые» фигуры как страховку от софтлока.
  fitting.sort(
    (a, b) =>
      AWKWARDNESS[a]! - AWKWARDNESS[b]! || SHAPES[a]!.cells.length - SHAPES[b]!.cells.length,
  );
  const pool = fitting.slice(0, Math.min(8, fitting.length));
  return pool[Math.floor(random() * pool.length)]!;
}

/**
 * Three distinct pieces. When a board is supplied, the set includes at least
 * one legal move whenever any shape can fit on that board.
 */
export function randomPieceSet(
  count = 3,
  score = 0,
  board?: Board | null,
  random: RandomSource = Math.random,
): Piece[] {
  const attempts = board ? 48 : 1;
  for (let i = 0; i < attempts; i++) {
    const set = buildRandomSet(count, score, random);
    if (!board || hasAnyMove(board, set)) return set;
  }

  if (!board) return buildRandomSet(count, score, random);

  // Fallback: force one placeable piece if the board is not actually full.
  const set = buildRandomSet(count, score, random);
  const lifeline = findPlaceableShapeIndex(board, new Set(), random);
  if (lifeline !== null) {
    set[0] = { id: randomId(random), shape: SHAPES[lifeline]!, color: set[0]!.color };
  }
  return set;
}

export function emptyBoard(): Board {
  return Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => null as Cell));
}

export function canPlace(board: Board, shape: Shape, row: number, col: number) {
  return shape.cells.every(([r, c]) => {
    const rr = row + r;
    const cc = col + c;
    return rr >= 0 && cc >= 0 && rr < SIZE && cc < SIZE && board[rr]![cc] === null;
  });
}

export function hasAnyMove(board: Board, pieces: (Piece | null)[]) {
  return pieces.some((p) => {
    if (!p) return false;
    return canPlaceAnywhere(board, p.shape);
  });
}

export function place(board: Board, piece: Piece, row: number, col: number): Board {
  const next = board.map((r) => r.slice());
  piece.shape.cells.forEach(([r, c]) => {
    next[row + r]![col + c] = piece.color;
  });
  return next;
}

export function findClears(board: Board) {
  const rows: number[] = [];
  const cols: number[] = [];
  for (let r = 0; r < SIZE; r++) if (board[r]!.every((c) => c !== null)) rows.push(r);
  for (let c = 0; c < SIZE; c++) if (board.every((row) => row[c] !== null)) cols.push(c);
  return { rows, cols };
}

export function applyClears(board: Board, rows: number[], cols: number[]): Board {
  const next = board.map((r) => r.slice());
  rows.forEach((r) => next[r]!.forEach((_, c) => (next[r]![c] = null)));
  cols.forEach((c) => next.forEach((row) => (row[c] = null)));
  return next;
}

/**
 * Очки за очистку.
 * @param streak — длина серии очисток подряд (1 = первая, 2+ = серия между ходами).
 */
export function clearScore(lines: number, score = 0, streak = 1) {
  if (lines <= 0) return 0;
  const d = difficultyFromScore(score);
  // База растёт со сложностью: 10→22 за линию, комбо в одном ходе 15→35
  const perLine = Math.round(10 + d * 12);
  const sameDropCombo = Math.round(15 + d * 20);
  const base = lines * perLine + (lines - 1) * sameDropCombo;
  // Серия между ходами: бонус с 2-й очистки подряд
  const streakBonus =
    streak > 1
      ? Math.round((streak - 1) * (10 + d * 14) + Math.max(0, streak - 2) * (4 + d * 6))
      : 0;
  return base + streakBonus;
}
