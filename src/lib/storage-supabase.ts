import { supabase } from "./supabase";
import type { GameMove } from "./verify-game-run.ts";

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

export type SavedGameRun = {
  runId: string;
  seed: string;
  randomState: number;
  moves: GameMove[];
};

export type SaveData = {
  board: Board;
  pieces: (SerializedPiece | null)[];
  score: number;
  gameRun?: SavedGameRun | null;
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
const remoteOperationTails = new Map<string, Promise<void>>();
const pendingRemoteSaves = new Map<
  string,
  { data: SaveData; updatedAt: number; operationId: number }
>();
let remoteSaveOperationId = 0;

function enqueueRemoteOperation<T>(userId: string, operation: () => Promise<T>): Promise<T> {
  const previous = remoteOperationTails.get(userId) ?? Promise.resolve();
  const result = previous.catch(() => undefined).then(operation);
  const tail = result.then(
    () => undefined,
    () => undefined,
  );
  remoteOperationTails.set(userId, tail);
  void tail.then(() => {
    if (remoteOperationTails.get(userId) === tail) remoteOperationTails.delete(userId);
  });
  return result;
}

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
    typeof piece.color !== "number" ||
    !Number.isInteger(piece.color) ||
    piece.color < 0 ||
    piece.color >= 9 ||
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

function isValidRunState(value: unknown): value is SavedGameRun | null | undefined {
  if (value === undefined || value === null) return true;
  if (typeof value !== "object") return false;
  const run = value as Partial<SavedGameRun>;
  return (
    typeof run.runId === "string" &&
    typeof run.seed === "string" &&
    Number.isInteger(run.randomState) &&
    Array.isArray(run.moves) &&
    run.moves.length <= 5000 &&
    run.moves.every(
      (move) =>
        !!move &&
        Number.isInteger(move.slot) &&
        move.slot >= 0 &&
        move.slot < 3 &&
        Number.isInteger(move.row) &&
        Number.isInteger(move.col),
    )
  );
}

function isValidSaveData(value: unknown): value is SaveData {
  if (!value || typeof value !== "object") return false;
  const save = value as Partial<SaveData>;
  if (
    !Number.isSafeInteger(save.score) ||
    (save.score ?? 0) < 0 ||
    !Array.isArray(save.board) ||
    !Array.isArray(save.pieces) ||
    !isValidRunState(save.gameRun)
  ) {
    return false;
  }

  const validBoard =
    save.board.length === BOARD_SIZE &&
    save.board.every(
      (row) =>
        Array.isArray(row) &&
        row.length === BOARD_SIZE &&
        row.every((cell) => cell === null || (Number.isInteger(cell) && cell >= 0 && cell < 9)),
    );

  return (
    validBoard &&
    save.pieces.length === 3 &&
    save.pieces.every((piece) => piece === null || isValidPiece(piece))
  );
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
    if (
      !isValidSaveData(record.data) ||
      !Number.isFinite(record.updatedAt) ||
      record.updatedAt < 0
    ) {
      window.localStorage.removeItem(saveKey(userId));
      return null;
    }
    return record;
  } catch {
    return null;
  }
}

function saveLocalGame(userId: string, data: SaveData, updatedAt = Date.now()) {
  if (!canUseLocalStorage()) return false;

  try {
    const record: LocalGameRecord = { data, updatedAt };
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

type RemoteGameRecord = {
  data: SaveData;
  updatedAt: number;
};

async function readRemoteGame(userId: string): Promise<RemoteGameRecord | null | undefined> {
  const response = await withTimeout(
    supabase
      .from("game_saves")
      .select("board, pieces, score, run_state, client_updated_at, updated_at")
      .eq("user_id", userId)
      .maybeSingle(),
  );
  if (!response) return undefined;
  if (response.error) return undefined;
  if (!response.data) return null;

  const data: SaveData = {
    board: response.data.board as Board,
    pieces: response.data.pieces as (SerializedPiece | null)[],
    score: response.data.score,
    gameRun: (response.data.run_state as SavedGameRun | null) ?? null,
  };
  const remoteTime = Date.parse(response.data.client_updated_at ?? response.data.updated_at);
  if (!isValidSaveData(data) || !Number.isFinite(remoteTime)) return undefined;
  return { data, updatedAt: remoteTime };
}

async function saveRemoteGame(userId: string, data: SaveData, updatedAt: number): Promise<boolean> {
  try {
    const { data: accepted, error } = await supabase.rpc("save_game_state", {
      p_board: data.board,
      p_pieces: data.pieces,
      p_score: data.score,
      p_run_state: data.gameRun ?? null,
      p_client_updated_at: new Date(updatedAt).toISOString(),
    });

    if (error) {
      console.error("Save error:", error);
      return false;
    }
    return accepted === true;
  } catch (error) {
    console.error("Save request failed:", error);
    return false;
  }
}

function queueRemoteSave(userId: string, data: SaveData, updatedAt: number): Promise<boolean> {
  const operationId = ++remoteSaveOperationId;
  pendingRemoteSaves.set(userId, { data, updatedAt, operationId });

  // Coalesce queued progress updates without moving a post-delete save ahead of the delete.
  return enqueueRemoteOperation(userId, async () => {
    const latest = pendingRemoteSaves.get(userId);
    if (!latest || latest.operationId > operationId) return true;
    pendingRemoteSaves.delete(userId);
    return saveRemoteGame(userId, latest.data, latest.updatedAt);
  });
}

export async function saveGame(userId: string, data: SaveData): Promise<boolean> {
  const previous = loadLocalGame(userId);
  const updatedAt = Math.max(Date.now(), (previous?.updatedAt ?? 0) + 1);
  const savedLocally = saveLocalGame(userId, data, updatedAt);
  if (!isOnline()) return savedLocally;

  const savedRemotely = await queueRemoteSave(userId, data, updatedAt);
  return savedLocally || savedRemotely;
}

export async function loadGame(userId: string): Promise<SaveData | null> {
  if (hasPendingLocalDeletion(userId)) return null;
  const local = loadLocalGame(userId);
  if (!isOnline()) return local?.data ?? null;

  const remote = await readRemoteGame(userId);
  if (remote === undefined) return local?.data ?? null;
  if (remote === null) {
    if (local) {
      void queueRemoteSave(userId, local.data, local.updatedAt);
    }
    return local?.data ?? null;
  }

  if (local && local.updatedAt > remote.updatedAt) {
    void queueRemoteSave(userId, local.data, local.updatedAt);
    return local.data;
  }

  saveLocalGame(userId, remote.data, remote.updatedAt);
  return remote.data;
}

async function deleteRemoteGame(userId: string): Promise<boolean> {
  try {
    const { error } = await supabase.from("game_saves").delete().eq("user_id", userId);

    if (error) {
      console.error("Clear save error:", error);
      return false;
    }
    return true;
  } catch (error) {
    console.error("Clear save request failed:", error);
    return false;
  }
}

export async function clearSave(userId: string): Promise<boolean> {
  markLocalGameDeleted(userId);
  if (!isOnline()) return true;

  const deleted = await enqueueRemoteOperation(userId, () => deleteRemoteGame(userId));
  if (!deleted) return false;
  clearPendingLocalDeletion(userId);
  return true;
}

/** Synchronizes the latest local game state when connectivity returns. */
export async function syncGame(userId: string): Promise<boolean> {
  if (!isOnline()) return false;

  if (hasPendingLocalDeletion(userId)) {
    const deleted = await enqueueRemoteOperation(userId, () => deleteRemoteGame(userId));
    if (!deleted) return false;
    clearPendingLocalDeletion(userId);
    return true;
  }

  const local = loadLocalGame(userId);
  const remote = await readRemoteGame(userId);
  if (remote === undefined) return false;
  if (!local) {
    if (remote) saveLocalGame(userId, remote.data, remote.updatedAt);
    return true;
  }
  if (!remote || local.updatedAt > remote.updatedAt) {
    return queueRemoteSave(userId, local.data, local.updatedAt);
  }

  saveLocalGame(userId, remote.data, remote.updatedAt);
  return true;
}

/** Best scores are local until the server verifies a complete replay. */
export function saveBestScore(userId: string, score: number): boolean {
  return saveLocalBestScore(userId, score);
}

export async function loadBestScore(userId: string): Promise<number> {
  const localScore = loadLocalBestScore(userId) ?? 0;
  if (!isOnline()) return localScore;

  const response = await withTimeout(
    supabase.from("best_scores").select("score").eq("user_id", userId).maybeSingle(),
  );
  const remoteScore = response?.data?.score;
  if (
    response?.error ||
    typeof remoteScore !== "number" ||
    !Number.isSafeInteger(remoteScore) ||
    remoteScore < 0
  ) {
    return localScore;
  }

  const bestScore = Math.max(localScore, remoteScore);
  saveLocalBestScore(userId, bestScore);
  return bestScore;
}

export type LeaderboardEntry = {
  name: string;
  score: number;
};

export async function getLeaderboard(limit = 50): Promise<LeaderboardEntry[]> {
  const safeLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
  const { data, error } = await supabase.rpc("get_leaderboard", {
    limit_count: safeLimit,
  });

  if (error) {
    console.error("Leaderboard error:", error);
    return [];
  }
  if (!Array.isArray(data)) return [];

  return (data as unknown[]).flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const row = entry as Record<string, unknown>;
    const score = row["score"];
    const name = row["name"];
    if (typeof score !== "number" || !Number.isSafeInteger(score) || score < 0) return [];
    return [{ name: typeof name === "string" ? name : "Unknown", score }];
  });
}
