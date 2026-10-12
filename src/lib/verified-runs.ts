import { supabase } from "./supabase";
import type { GameMove } from "./verify-game-run";

export type StartedGameRun = {
  runId: string;
  seed: string;
};

export type SubmittedGameRun = {
  score: number;
  bestScore: number;
  rewardPoints: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export async function startVerifiedGameRun(): Promise<StartedGameRun | null> {
  if (typeof navigator !== "undefined" && !navigator.onLine) return null;

  try {
    const { data, error } = await supabase.rpc("start_verified_game_run");
    if (error || !data) return null;

    const row = Array.isArray(data) ? data[0] : data;
    if (!isRecord(row)) return null;
    const runId = row["run_id"];
    const seed = row["seed"];
    if (typeof runId !== "string" || typeof seed !== "string") return null;

    return { runId, seed };
  } catch {
    return null;
  }
}

export async function submitVerifiedGameRun(
  runId: string,
  moves: readonly GameMove[],
): Promise<SubmittedGameRun | null> {
  try {
    const { data, error } = await supabase.functions.invoke("submit-game-run", {
      body: { runId, moves },
    });
    if (error || !isRecord(data)) return null;

    const score = data["score"];
    const bestScore = data["bestScore"];
    const rewardPoints = data["rewardPoints"];
    if (
      typeof score !== "number" ||
      !Number.isSafeInteger(score) ||
      score < 0 ||
      typeof bestScore !== "number" ||
      !Number.isSafeInteger(bestScore) ||
      bestScore < 0 ||
      typeof rewardPoints !== "number" ||
      !Number.isSafeInteger(rewardPoints) ||
      rewardPoints < 0
    ) {
      return null;
    }

    return { score, bestScore, rewardPoints };
  } catch {
    return null;
  }
}
