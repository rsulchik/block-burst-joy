-- Referral codes are public identifiers. The relationship itself remains private.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS referral_code TEXT;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS referred_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

UPDATE public.profiles
SET referral_code = LOWER(SUBSTRING(REPLACE(id::TEXT, '-', '') FROM 1 FOR 12))
WHERE referral_code IS NULL OR BTRIM(referral_code) = '';

ALTER TABLE public.profiles
  ALTER COLUMN referral_code SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_referral_code_unique
  ON public.profiles (LOWER(referral_code));

CREATE INDEX IF NOT EXISTS profiles_referred_by_idx
  ON public.profiles (referred_by);

CREATE OR REPLACE FUNCTION public.is_referral_code_valid(p_referral_code TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  normalized_code TEXT := LOWER(REGEXP_REPLACE(COALESCE(p_referral_code, ''), '[^a-zA-Z0-9]', '', 'g'));
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE LOWER(referral_code) = normalized_code
      OR (
        CHAR_LENGTH(normalized_code) = 8
        AND LEFT(LOWER(referral_code), 8) = normalized_code
      )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_referral_code(p_referral_code TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  normalized_code TEXT := LOWER(REGEXP_REPLACE(COALESCE(p_referral_code, ''), '[^a-zA-Z0-9]', '', 'g'));
  referrer_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication is required';
  END IF;

  SELECT id INTO referrer_id
  FROM public.profiles
  WHERE LOWER(referral_code) = normalized_code
    OR (
      CHAR_LENGTH(normalized_code) = 8
      AND LEFT(LOWER(referral_code), 8) = normalized_code
    )
  LIMIT 1;

  IF referrer_id IS NULL OR referrer_id = auth.uid() THEN
    RETURN FALSE;
  END IF;

  UPDATE public.profiles
  SET referred_by = referrer_id
  WHERE id = auth.uid() AND referred_by IS NULL;

  RETURN FOUND;
END;
$$;

-- New registrations receive the referral code in auth metadata before this trigger runs.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  normalized_code TEXT := LOWER(REGEXP_REPLACE(
    COALESCE(NEW.raw_user_meta_data->>'referral_code', ''),
    '[^a-zA-Z0-9]',
    '',
    'g'
  ));
  referrer_id UUID;
BEGIN
  SELECT id INTO referrer_id
  FROM public.profiles
  WHERE LOWER(referral_code) = normalized_code
    OR (
      CHAR_LENGTH(normalized_code) = 8
      AND LEFT(LOWER(referral_code), 8) = normalized_code
    )
  LIMIT 1;

  INSERT INTO public.profiles (id, name, phone, referral_code, referred_by)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', 'Player'),
    COALESCE(NEW.raw_user_meta_data->>'phone', ''),
    LOWER(SUBSTRING(REPLACE(NEW.id::TEXT, '-', '') FROM 1 FOR 12)),
    CASE WHEN referrer_id = NEW.id THEN NULL ELSE referrer_id END
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.is_referral_code_valid(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_referral_code(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_referral_code_valid(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_referral_code(TEXT) TO authenticated;
