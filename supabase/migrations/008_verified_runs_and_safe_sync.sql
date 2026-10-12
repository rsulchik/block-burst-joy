-- Additive hardening: keep existing player data while moving score/reward writes
-- behind a server-side replay verifier and making game-save sync last-write-wins.

ALTER TABLE public.game_saves
  ADD COLUMN IF NOT EXISTS client_updated_at TIMESTAMPTZ;

ALTER TABLE public.game_saves
  ADD COLUMN IF NOT EXISTS run_state JSONB;

UPDATE public.game_saves
SET client_updated_at = updated_at
WHERE client_updated_at IS NULL;

ALTER TABLE public.game_saves
  ALTER COLUMN client_updated_at SET DEFAULT TIMEZONE('utc', NOW()),
  ALTER COLUMN client_updated_at SET NOT NULL;

CREATE TABLE IF NOT EXISTS public.game_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  seed TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  submitted_move_count INTEGER NOT NULL DEFAULT 0 CHECK (submitted_move_count >= 0),
  verified_score INTEGER NOT NULL DEFAULT 0 CHECK (verified_score >= 0),
  moves_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW()),
  finalized_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS game_runs_one_active_per_user
  ON public.game_runs (user_id)
  WHERE active;

ALTER TABLE public.game_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.game_runs FROM PUBLIC, anon, authenticated;

-- Only reads and deletes remain available directly. Writes go through the RPC,
-- which binds the row to auth.uid() and rejects stale client revisions.
REVOKE ALL ON TABLE public.game_saves FROM PUBLIC, anon, authenticated;
GRANT SELECT, DELETE ON TABLE public.game_saves TO authenticated;

CREATE OR REPLACE FUNCTION public.save_game_state(
  p_board JSONB,
  p_pieces JSONB,
  p_score INTEGER,
  p_run_state JSONB,
  p_client_updated_at TIMESTAMPTZ
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller_id UUID := auth.uid();
  safe_client_time TIMESTAMPTZ;
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required';
  END IF;
  IF p_score IS NULL OR p_score < 0 THEN
    RAISE EXCEPTION 'Invalid game score';
  END IF;
  IF jsonb_typeof(p_board) IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_board) <> 8
    OR jsonb_typeof(p_pieces) IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_pieces) <> 3
    OR (p_run_state IS NOT NULL AND jsonb_typeof(p_run_state) IS DISTINCT FROM 'object') THEN
    RAISE EXCEPTION 'Invalid game state';
  END IF;
  IF p_client_updated_at IS NULL THEN
    RAISE EXCEPTION 'A client revision timestamp is required';
  END IF;

  -- A bad device clock must not pin a save in the future indefinitely.
  safe_client_time := LEAST(p_client_updated_at, TIMEZONE('utc', NOW()) + INTERVAL '5 minutes');

  INSERT INTO public.game_saves (user_id, board, pieces, score, run_state, client_updated_at)
  VALUES (caller_id, p_board, p_pieces, p_score, p_run_state, safe_client_time)
  ON CONFLICT (user_id) DO UPDATE
  SET board = EXCLUDED.board,
      pieces = EXCLUDED.pieces,
      score = EXCLUDED.score,
      run_state = EXCLUDED.run_state,
      client_updated_at = EXCLUDED.client_updated_at
  WHERE EXCLUDED.client_updated_at >= public.game_saves.client_updated_at;

  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.start_verified_game_run()
RETURNS TABLE (run_id UUID, seed TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller_id UUID := auth.uid();
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required';
  END IF;

  -- Starting a new run abandons any unfinished one for this account.
  UPDATE public.game_runs
  SET active = FALSE
  WHERE user_id = caller_id AND active;

  RETURN QUERY
  INSERT INTO public.game_runs (user_id, seed)
  VALUES (caller_id, gen_random_uuid()::TEXT)
  RETURNING id, public.game_runs.seed;
END;
$$;

-- This is the only function allowed to publish scores or credit daily rewards.
-- It is callable only by the trusted Edge Function after replay verification.
CREATE OR REPLACE FUNCTION public.record_verified_game_run(
  p_user_id UUID,
  p_run_id UUID,
  p_score INTEGER,
  p_move_count INTEGER,
  p_moves_hash TEXT
)
RETURNS TABLE (verified_score INTEGER, best_score INTEGER, reward_points INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  run_row public.game_runs%ROWTYPE;
  best_value INTEGER;
  task_row public.daily_tasks%ROWTYPE;
  completion_id UUID;
  reward_value INTEGER := 0;
BEGIN
  IF current_setting('request.jwt.claim.role', TRUE) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Only the verified game service may record a result';
  END IF;
  IF p_user_id IS NULL OR p_run_id IS NULL OR p_score < 0 OR p_move_count < 1
    OR p_moves_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid verified result';
  END IF;

  SELECT * INTO run_row
  FROM public.game_runs
  WHERE id = p_run_id AND user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Run not found';
  END IF;

  -- Permit exact retries after a network timeout, but no edits or score changes.
  IF NOT run_row.active THEN
    IF run_row.finalized_at IS NOT NULL
      AND run_row.submitted_move_count = p_move_count
      AND run_row.verified_score = p_score
      AND run_row.moves_hash = p_moves_hash THEN
      SELECT COALESCE(MAX(bs.score), 0) INTO best_value
      FROM public.best_scores AS bs
      WHERE bs.user_id = p_user_id;
      RETURN QUERY SELECT run_row.verified_score, COALESCE(best_value, 0), 0;
      RETURN;
    END IF;
    RAISE EXCEPTION 'Run is no longer active';
  END IF;

  UPDATE public.game_runs
  SET active = FALSE,
      submitted_move_count = p_move_count,
      verified_score = p_score,
      moves_hash = p_moves_hash,
      finalized_at = TIMEZONE('utc', NOW())
  WHERE id = p_run_id;

  INSERT INTO public.best_scores (user_id, score)
  VALUES (p_user_id, p_score)
  ON CONFLICT (user_id) DO UPDATE
  SET score = GREATEST(public.best_scores.score, EXCLUDED.score);

  SELECT score INTO best_value
  FROM public.best_scores
  WHERE user_id = p_user_id;

  SELECT * INTO task_row
  FROM public.daily_tasks
  WHERE task_date = (TIMEZONE('utc', NOW()))::DATE
  ORDER BY created_at ASC
  LIMIT 1;

  IF FOUND AND p_score >= task_row.target_score THEN
    INSERT INTO public.task_completions (task_id, user_id)
    VALUES (task_row.id, p_user_id)
    ON CONFLICT (user_id, task_id) DO NOTHING
    RETURNING id INTO completion_id;

    IF completion_id IS NOT NULL THEN
      PERFORM SET_CONFIG('app.wallet_reward_claim', 'true', TRUE);
      UPDATE public.profiles
      SET wallet_points = wallet_points + task_row.reward_points
      WHERE id = p_user_id;
      reward_value := task_row.reward_points;
    END IF;
  END IF;

  RETURN QUERY SELECT p_score, COALESCE(best_value, 0), reward_value;
END;
$$;

-- The old client-callable function trusted a task id and credited points without
-- proof of a score. Disable it; verified submissions now use the Edge Function.
REVOKE ALL ON FUNCTION public.claim_daily_task_reward(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.save_game_state(JSONB, JSONB, INTEGER, JSONB, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.start_verified_game_run() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_verified_game_run(UUID, UUID, INTEGER, INTEGER, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_game_state(JSONB, JSONB, INTEGER, JSONB, TIMESTAMPTZ)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_verified_game_run() TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_verified_game_run(UUID, UUID, INTEGER, INTEGER, TEXT)
  TO service_role;

-- Do not permit client writes to competitive scores or reward receipts.
REVOKE ALL ON TABLE public.best_scores FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.best_scores TO authenticated;
REVOKE ALL ON TABLE public.task_completions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.task_completions TO authenticated;

DROP POLICY IF EXISTS "Users can view all best scores" ON public.best_scores;
DROP POLICY IF EXISTS "Users can view own best score" ON public.best_scores;
CREATE POLICY "Users can view own best score" ON public.best_scores
  FOR SELECT USING (auth.uid() = user_id);
