-- Создаём RPC функцию для получения рейтинга с LEFT JOIN
CREATE OR REPLACE FUNCTION public.get_leaderboard(limit_count integer DEFAULT 50)
RETURNS TABLE (
  name text,
  score bigint,
  phone text
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COALESCE(p.name, 'Unknown') as name,
    bs.score,
    COALESCE(p.phone, '') as phone
  FROM public.best_scores bs
  LEFT JOIN public.profiles p ON bs.user_id = p.id
  ORDER BY bs.score DESC
  LIMIT limit_count;
END;
$$;

-- Даём публичный доступ к этой функции
GRANT EXECUTE ON FUNCTION public.get_leaderboard(integer) TO anon;
GRANT EXECUTE ON FUNCTION public.get_leaderboard(integer) TO authenticated;
