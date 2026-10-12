-- Удаляем существующие триггеры
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP TRIGGER IF EXISTS profiles_updated_at ON public.profiles;
DROP TRIGGER IF EXISTS game_saves_updated_at ON public.game_saves;
DROP TRIGGER IF EXISTS best_scores_updated_at ON public.best_scores;

-- Удаляем существующие функции
DROP FUNCTION IF EXISTS public.handle_new_user();
DROP FUNCTION IF EXISTS public.handle_updated_at();

-- Replace policies by name without exposing profiles or leaderboard rows.
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can view all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can view own save" ON public.game_saves;
DROP POLICY IF EXISTS "Users can insert own save" ON public.game_saves;
DROP POLICY IF EXISTS "Users can update own save" ON public.game_saves;
DROP POLICY IF EXISTS "Users can delete own save" ON public.game_saves;
DROP POLICY IF EXISTS "Users can view own best score" ON public.best_scores;
DROP POLICY IF EXISTS "Users can view all best scores" ON public.best_scores;
DROP POLICY IF EXISTS "Users can insert own best score" ON public.best_scores;
DROP POLICY IF EXISTS "Users can update own best score" ON public.best_scores;

-- This migration used to drop and recreate the core tables. Keep it additive:
-- production databases may already contain player profiles, saves, and scores.
-- Never put destructive table resets in the normal migration chain.

-- Создаём таблицу профилей пользователей (дополнение к auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID REFERENCES auth.users(id) PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT UNIQUE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()) NOT NULL
);

-- Создаём таблицу для сохранений игр
CREATE TABLE IF NOT EXISTS public.game_saves (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  board JSONB NOT NULL,
  pieces JSONB NOT NULL,
  score INTEGER NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()) NOT NULL,
  CONSTRAINT unique_user_save UNIQUE (user_id)
);

-- Создаём таблицу для лучших результатов
CREATE TABLE IF NOT EXISTS public.best_scores (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  score INTEGER NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()) NOT NULL,
  CONSTRAINT unique_user_best UNIQUE (user_id)
);

-- Включаем RLS (Row Level Security)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_saves ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.best_scores ENABLE ROW LEVEL SECURITY;

-- Profiles are private; the public leaderboard is served by a column-safe RPC.
CREATE POLICY "Users can view own profile" ON public.profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile" ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE USING (auth.uid() = id);

-- Политики для game_saves
CREATE POLICY "Users can view own save" ON public.game_saves
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own save" ON public.game_saves
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own save" ON public.game_saves
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own save" ON public.game_saves
  FOR DELETE USING (auth.uid() = user_id);

-- Scores are private; use the leaderboard RPC for public display.
CREATE POLICY "Users can view own best score" ON public.best_scores
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own best score" ON public.best_scores
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own best score" ON public.best_scores
  FOR UPDATE USING (auth.uid() = user_id);

-- Триггер для обновления updated_at
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = TIMEZONE('utc', NOW());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER game_saves_updated_at BEFORE UPDATE ON public.game_saves
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER best_scores_updated_at BEFORE UPDATE ON public.best_scores
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Триггер для автоматического создания профиля при регистрации
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, name, phone)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', 'Player'),
    COALESCE(NEW.raw_user_meta_data->>'phone', '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Таблица для устройств пользователей (push токены)
CREATE TABLE IF NOT EXISTS public.user_devices (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  push_token TEXT NOT NULL,
  platform TEXT NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()) NOT NULL
);

-- Таблица для ежедневных заданий
CREATE TABLE IF NOT EXISTS public.daily_tasks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  target_score INTEGER NOT NULL,
  reward_points INTEGER NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()) NOT NULL
);

-- Таблица для выполненных заданий
CREATE TABLE IF NOT EXISTS public.task_completions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  task_id UUID REFERENCES public.daily_tasks(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  completed_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()) NOT NULL,
  CONSTRAINT unique_user_task UNIQUE (user_id, task_id)
);

-- Включаем RLS для новых таблиц
ALTER TABLE public.user_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_completions ENABLE ROW LEVEL SECURITY;

-- Политики для user_devices
CREATE POLICY "Users can insert own device" ON public.user_devices
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own device" ON public.user_devices
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own device" ON public.user_devices
  FOR DELETE USING (auth.uid() = user_id);

-- Политики для daily_tasks (все могут просматривать, только админ может создавать)
CREATE POLICY "Anyone can view daily tasks" ON public.daily_tasks
  FOR SELECT USING (true);

-- Политики для task_completions
CREATE POLICY "Users can view own completions" ON public.task_completions
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own completion" ON public.task_completions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Триггеры для новых таблиц
CREATE TRIGGER user_devices_updated_at BEFORE UPDATE ON public.user_devices
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
