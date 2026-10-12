import { supabase } from './supabase';

export type SerializedPiece = {
  id: string;
  color: number;
  shape: {
    cells: [number, number][];
    w: number;
    h: number;
  };
};

export type Board = (number | null)[][];

export type SaveData = {
  board: Board;
  pieces: (SerializedPiece | null)[];
  score: number;
};

type LocalGameRecord = {
  data: SaveData;
  updatedAt: number;
};

const LOCAL_SAVE_PREFIX = "blockblast.game.v1:";
const LOCAL_DELETE_PREFIX = "blockblast.game-delete.v1:";
const LOCAL_BEST_PREFIX = "blockblast.best.v1:";
const BOARD_SIZE = 8;
const REMOTE_LOAD_TIMEOUT_MS = 3500;

function saveKey(userId: string) {
  return `${LOCAL_SAVE_PREFIX}${userId}`;
}

function deleteKey(userId: string) {
  return `${LOCAL_DELETE_PREFIX}${userId}`;
}

function bestKey(userId: string) {
  return `${LOCAL_BEST_PREFIX}${userId}`;
}

function canUseLocalStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function isOnline() {
  return typeof navigator === "undefined" || navigator.onLine;
}

function isValidPiece(value: unknown): value is SerializedPiece {
  if (!value || typeof value !== "object") return false;
  const piece = value as Partial<SerializedPiece>;
  const shape = piece.shape;
  if (
    typeof piece.id !== "string" ||
    !Number.isInteger(piece.color) ||
    !shape ||
    typeof shape !== "object" ||
    !Number.isInteger(shape.w) ||
    !Number.isInteger(shape.h) ||
    shape.w < 1 ||
    shape.w > BOARD_SIZE ||
    shape.h < 1 ||
    shape.h > BOARD_SIZE ||
    !Array.isArray(shape.cells) ||
    shape.cells.length < 1 ||
    shape.cells.length > BOARD_SIZE * BOARD_SIZE
  ) {
    return false;
  }

  return shape.cells.every(
    (cell) =>
      Array.isArray(cell) &&
      cell.length === 2 &&
      Number.isInteger(cell[0]) &&
      Number.isInteger(cell[1]) &&
      cell[0] >= 0 &&
      cell[0] < shape.h &&
      cell[1] >= 0 &&
      cell[1] < shape.w,
  );
}

function isValidSaveData(value: unknown): value is SaveData {
  if (!value || typeof value !== "object") return false;
  const save = value as Partial<SaveData>;
  if (!Number.isFinite(save.score) || (save.score ?? 0) < 0 || !Array.isArray(save.board) || !Array.isArray(save.pieces)) {
    return false;
  }

  const validBoard =
    save.board.length === BOARD_SIZE &&
    save.board.every(
      (row) =>
        Array.isArray(row) &&
        row.length === BOARD_SIZE &&
        row.every((cell) => cell === null || (Number.isInteger(cell) && cell >= 0 && cell <= 9)),
    );

  return validBoard && save.pieces.length === 3 && save.pieces.every((piece) => piece === null || isValidPiece(piece));
}

async function withTimeout<T>(request: PromiseLike<T>): Promise<T | null> {
  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => resolve(null), REMOTE_LOAD_TIMEOUT_MS);
    Promise.resolve(request).then(
      (value) => {
        clearTimeout(timeoutId);
        resolve(value);
      },
      () => {
        clearTimeout(timeoutId);
        resolve(null);
      },
    );
  });
}

function loadLocalGame(userId: string): LocalGameRecord | null {
  if (!canUseLocalStorage()) return null;

  try {
    const raw = window.localStorage.getItem(saveKey(userId));
    if (!raw) return null;
    const record = JSON.parse(raw) as LocalGameRecord;
    if (!isValidSaveData(record.data)) {
      window.localStorage.removeItem(saveKey(userId));
      return null;
    }
    return record;
  } catch {
    return null;
  }
}

function saveLocalGame(userId: string, data: SaveData) {
  if (!canUseLocalStorage()) return false;

  try {
    const record: LocalGameRecord = { data, updatedAt: Date.now() };
    window.localStorage.setItem(saveKey(userId), JSON.stringify(record));
    window.localStorage.removeItem(deleteKey(userId));
    return true;
  } catch {
    return false;
  }
}

function markLocalGameDeleted(userId: string) {
  if (!canUseLocalStorage()) return;

  try {
    window.localStorage.removeItem(saveKey(userId));
    window.localStorage.setItem(deleteKey(userId), String(Date.now()));
  } catch {
    // A cloud deletion is still attempted when the device is online.
  }
}

function hasPendingLocalDeletion(userId: string) {
  if (!canUseLocalStorage()) return false;

  try {
    return window.localStorage.getItem(deleteKey(userId)) !== null;
  } catch {
    return false;
  }
}

function clearPendingLocalDeletion(userId: string) {
  if (!canUseLocalStorage()) return;

  try {
    window.localStorage.removeItem(deleteKey(userId));
  } catch {
    // The next online event will retry the deletion.
  }
}

function loadLocalBestScore(userId: string): number | null {
  if (!canUseLocalStorage()) return null;

  try {
    const raw = window.localStorage.getItem(bestKey(userId));
    if (raw === null) return null;
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 ? value : null;
  } catch {
    return null;
  }
}

function saveLocalBestScore(userId: string, score: number) {
  if (!canUseLocalStorage()) return false;

  try {
    const current = loadLocalBestScore(userId) ?? 0;
    window.localStorage.setItem(bestKey(userId), String(Math.max(current, score)));
    return true;
  } catch {
    return false;
  }
}

async function saveRemoteGame(userId: string, data: SaveData): Promise<boolean> {
  const { error } = await supabase
    .from('game_saves')
    .upsert({
      user_id: userId,
      board: data.board,
      pieces: data.pieces,
      score: data.score,
    }, {
      onConflict: 'user_id',
    });

  if (error) {
    console.error('Save error:', error);
    return false;
  }
  return true;
}

export async function saveGame(userId: string, data: SaveData): Promise<boolean> {
  const savedLocally = saveLocalGame(userId, data);
  if (!isOnline()) return savedLocally;

  const savedRemotely = await saveRemoteGame(userId, data);
  return savedLocally || savedRemotely;
}

export async function loadGame(userId: string): Promise<SaveData | null> {
  const local = loadLocalGame(userId);
  if (local) return local.data;
  if (!isOnline() || hasPendingLocalDeletion(userId)) return null;

  const response = await withTimeout(
    supabase
      .from('game_saves')
      .select('board, pieces, score')
      .eq('user_id', userId)
      .single(),
  );

  if (!response || response.error || !response.data) {
    return null;
  }

  const game = {
    board: response.data.board as Board,
    pieces: response.data.pieces as (SerializedPiece | null)[],
    score: response.data.score,
  };

  if (!isValidSaveData(game)) return null;

  saveLocalGame(userId, game);
  return game;
}

export async function clearSave(userId: string): Promise<boolean> {
  markLocalGameDeleted(userId);
  if (!isOnline()) return true;

  const { error } = await supabase
    .from('game_saves')
    .delete()
    .eq('user_id', userId);

  if (error) {
    console.error('Clear save error:', error);
    return false;
  }
  clearPendingLocalDeletion(userId);
  return true;
}

/** Synchronizes the latest local game state when connectivity returns. */
export async function syncGame(userId: string): Promise<boolean> {
  if (!isOnline()) return false;

  if (hasPendingLocalDeletion(userId)) {
    const { error } = await supabase
      .from('game_saves')
      .delete()
      .eq('user_id', userId);

    if (error) return false;
    clearPendingLocalDeletion(userId);
    return true;
  }

  const local = loadLocalGame(userId);
  if (!local) return true;
  return saveRemoteGame(userId, local.data);
}

export async function saveBestScore(userId: string, score: number): Promise<boolean> {
  const savedLocally = saveLocalBestScore(userId, score);
  if (!isOnline()) return savedLocally;

  const { error } = await supabase
    .from('best_scores')
    .upsert({
      user_id: userId,
      score,
    }, {
      onConflict: 'user_id',
    });

  if (error) {
    console.error('Save best score error:', error);
    return false;
  }
  return savedLocally || !error;
}

export async function loadBestScore(userId: string): Promise<number> {
  const localScore = loadLocalBestScore(userId);
  if (localScore !== null) return localScore;
  if (!isOnline()) return 0;

  const response = await withTimeout(
    supabase
      .from('best_scores')
      .select('score')
      .eq('user_id', userId)
      .single(),
  );

  if (!response || response.error || !response.data || !Number.isFinite(response.data.score) || response.data.score < 0) {
    return 0;
  }
  saveLocalBestScore(userId, response.data.score);
  return response.data.score;
}

/** Synchronizes locally cached best score when connectivity returns. */
export async function syncBestScore(userId: string): Promise<boolean> {
  const score = loadLocalBestScore(userId);
  if (score === null || !isOnline()) return false;
  return saveBestScore(userId, score);
}

export type LeaderboardEntry = {
  name: string;
  score: number;
};

export async function getLeaderboard(limit: number = 50): Promise<LeaderboardEntry[]> {
  // Прямой запрос с LEFT JOIN через Supabase
  const { data, error } = await supabase.rpc('get_leaderboard', {
    limit_count: limit,
  });

  if (error) {
    console.error('Leaderboard error:', error);
    return [];
  }

  if (!data) {
    return [];
  }

  return data.map((entry: any) => ({
    name: entry.name || 'Unknown',
    score: entry.score,
  }));
}
