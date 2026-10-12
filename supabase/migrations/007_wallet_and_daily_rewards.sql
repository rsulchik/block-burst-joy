-- A server-controlled wallet for daily-task rewards.
-- These tables are created here as some existing projects were set up before
-- daily tasks were added to the schema.
CREATE TABLE IF NOT EXISTS public.daily_tasks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  target_score INTEGER NOT NULL,
  reward_points INTEGER NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.task_completions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  task_id UUID REFERENCES public.daily_tasks(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  completed_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()) NOT NULL
);

ALTER TABLE public.daily_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_completions ENABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX IF NOT EXISTS task_completions_one_reward_per_task
  ON public.task_completions (user_id, task_id);

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS wallet_points INTEGER NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.protect_wallet_points()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.wallet_points IS DISTINCT FROM OLD.wallet_points
    AND CURRENT_SETTING('app.wallet_reward_claim', TRUE) IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'Wallet points can only be changed by a reward claim';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_wallet_points ON public.profiles;

CREATE TRIGGER protect_wallet_points
  BEFORE UPDATE OF wallet_points ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_wallet_points();

ALTER TABLE public.daily_tasks
  ADD COLUMN IF NOT EXISTS task_date DATE;

UPDATE public.daily_tasks
SET task_date = (created_at AT TIME ZONE 'UTC')::DATE
WHERE task_date IS NULL;

ALTER TABLE public.daily_tasks
  ALTER COLUMN task_date SET NOT NULL;

CREATE INDEX IF NOT EXISTS daily_tasks_by_date
  ON public.daily_tasks (task_date);

CREATE OR REPLACE FUNCTION public.get_daily_task()
RETURNS SETOF public.daily_tasks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  current_day DATE := (TIMEZONE('UTC', NOW()))::DATE;
  task_variant INTEGER := MOD(ABS(HASHTEXT(current_day::TEXT)), 3);
BEGIN
  PERFORM pg_advisory_xact_lock(102026);

  IF NOT EXISTS (SELECT 1 FROM public.daily_tasks WHERE task_date = current_day) THEN
    IF task_variant = 0 THEN
      INSERT INTO public.daily_tasks (title, description, target_score, reward_points, task_date)
      VALUES ('Gündelik rekord', 'Bir oýunda 250 oçko ýygnaň', 250, 50, current_day);
    ELSIF task_variant = 1 THEN
      INSERT INTO public.daily_tasks (title, description, target_score, reward_points, task_date)
      VALUES ('Ussat hereket', 'Bir oýunda 500 oçko ýygnaň', 500, 75, current_day);
    ELSE
      INSERT INTO public.daily_tasks (title, description, target_score, reward_points, task_date)
      VALUES ('Soňky synag', 'Bir oýunda 750 oçko ýygnaň', 750, 100, current_day);
    END IF;
  END IF;

  RETURN QUERY
  SELECT *
  FROM public.daily_tasks
  WHERE task_date = current_day
  ORDER BY created_at ASC
  LIMIT 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_daily_task_reward(p_task_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  task_reward INTEGER;
  completion_id UUID;
  current_day DATE := (TIMEZONE('UTC', NOW()))::DATE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication is required';
  END IF;

  SELECT reward_points INTO task_reward
  FROM public.daily_tasks
  WHERE id = p_task_id AND task_date = current_day;

  IF task_reward IS NULL THEN
    RETURN 0;
  END IF;

  INSERT INTO public.task_completions (task_id, user_id)
  VALUES (p_task_id, auth.uid())
  ON CONFLICT (user_id, task_id) DO NOTHING
  RETURNING id INTO completion_id;

  IF completion_id IS NULL THEN
    RETURN 0;
  END IF;

  PERFORM SET_CONFIG('app.wallet_reward_claim', 'true', TRUE);

  UPDATE public.profiles
  SET wallet_points = wallet_points + task_reward
  WHERE id = auth.uid();

  RETURN task_reward;
END;
$$;

REVOKE ALL ON FUNCTION public.get_daily_task() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_daily_task_reward(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_daily_task() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_daily_task_reward(UUID) TO authenticated;
