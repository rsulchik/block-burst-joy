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

-- Политики для profiles
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

-- Политики для best_scores
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
