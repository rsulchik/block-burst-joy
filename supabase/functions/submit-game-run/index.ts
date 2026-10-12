import { createClient } from "npm:@supabase/supabase-js@2";
import {
  MAX_VERIFIED_MOVES,
  verifyGameRun,
  type GameMove,
} from "../../../src/lib/verify-game-run.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isMove(value: unknown): value is GameMove {
  if (!isRecord(value)) return false;
  return (
    Number.isInteger(value["slot"]) &&
    Number.isInteger(value["row"]) &&
    Number.isInteger(value["col"])
  );
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const authorization = request.headers.get("Authorization");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!authorization || !supabaseUrl || !anonKey || !serviceRoleKey) {
    return jsonResponse({ error: "Authentication or server configuration is missing" }, 401);
  }

  try {
    const authClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: authData, error: authError } = await authClient.auth.getUser();
    if (authError || !authData.user) return jsonResponse({ error: "Unauthorized" }, 401);

    const body: unknown = await request.json();
    if (!isRecord(body) || typeof body["runId"] !== "string" || !Array.isArray(body["moves"])) {
      return jsonResponse({ error: "Invalid request" }, 400);
    }
    const runId = body["runId"];
    const moves = body["moves"];
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(runId) ||
      moves.length === 0 ||
      moves.length > MAX_VERIFIED_MOVES ||
      !moves.every(isMove)
    ) {
      return jsonResponse({ error: "Invalid game moves" }, 400);
    }

    const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: run, error: runError } = await serviceClient
      .from("game_runs")
      .select("id, seed")
      .eq("id", runId)
      .eq("user_id", authData.user.id)
      .maybeSingle();

    if (runError || !run) return jsonResponse({ error: "Run not found" }, 404);

    let verified: ReturnType<typeof verifyGameRun>;
    try {
      verified = verifyGameRun(run.seed, moves);
    } catch {
      return jsonResponse({ error: "Game replay could not be verified" }, 400);
    }
    if (!verified.gameOver) {
      return jsonResponse({ error: "Finish the run before submitting it" }, 400);
    }

    const movesHash = await sha256(JSON.stringify(moves));
    const { data: savedResult, error: saveError } = await serviceClient.rpc(
      "record_verified_game_run",
      {
        p_user_id: authData.user.id,
        p_run_id: run.id,
        p_score: verified.score,
        p_move_count: moves.length,
        p_moves_hash: movesHash,
      },
    );
    if (saveError) {
      console.error("Verified game result rejected:", saveError.message);
      return jsonResponse({ error: "Could not save verified result" }, 409);
    }

    const row = Array.isArray(savedResult) ? savedResult[0] : savedResult;
    if (!isRecord(row)) return jsonResponse({ error: "Invalid verification response" }, 500);
    const score = row["verified_score"];
    const bestScore = row["best_score"];
    const rewardPoints = row["reward_points"];
    if (
      typeof score !== "number" ||
      !Number.isSafeInteger(score) ||
      typeof bestScore !== "number" ||
      !Number.isSafeInteger(bestScore) ||
      typeof rewardPoints !== "number" ||
      !Number.isSafeInteger(rewardPoints)
    ) {
      return jsonResponse({ error: "Invalid verification response" }, 500);
    }
    return jsonResponse({ score, bestScore, rewardPoints });
  } catch (error) {
    console.error("Game run submission failed:", error);
    return jsonResponse({ error: "Game run submission failed" }, 500);
  }
});
