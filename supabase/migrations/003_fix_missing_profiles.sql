-- Создаём профили для пользователей, у которых их нет
INSERT INTO public.profiles (id, name, phone)
SELECT 
  au.id,
  COALESCE(au.raw_user_meta_data->>'name', 'Player'),
  COALESCE(au.raw_user_meta_data->>'phone', '')
FROM auth.users au
LEFT JOIN public.profiles p ON au.id = p.id
WHERE p.id IS NULL;
