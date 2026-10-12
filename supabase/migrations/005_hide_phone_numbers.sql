-- Keep phone numbers private while exposing a name and score in the leaderboard.
DROP POLICY IF EXISTS "Users can view all profiles" ON public.profiles;

CREATE POLICY "Users can view own profile" ON public.profiles
  FOR SELECT USING (auth.uid() = id);

DROP FUNCTION IF EXISTS public.get_leaderboard(integer);

CREATE FUNCTION public.get_leaderboard(limit_count integer DEFAULT 50)
RETURNS TABLE (
  name text,
  score bigint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    COALESCE(p.name, 'Unknown') AS name,
    bs.score
  FROM public.best_scores AS bs
  LEFT JOIN public.profiles AS p ON p.id = bs.user_id
  ORDER BY bs.score DESC
  LIMIT limit_count;
$$;

GRANT EXECUTE ON FUNCTION public.get_leaderboard(integer) TO anon;
GRANT EXECUTE ON FUNCTION public.get_leaderboard(integer) TO authenticated;
