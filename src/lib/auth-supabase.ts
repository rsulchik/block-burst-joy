import { supabase } from './supabase';

export type AuthUser = {
  id: string;
  name: string;
  phone: string;
};

export type AuthResult = { ok: true; user: AuthUser } | { ok: false; error: string };

const REFERRAL_CODE_LENGTH = 12;
const LEGACY_REFERRAL_CODE_LENGTH = 8;

export function referralCodeForUser(userId: string): string {
  return userId.replace(/-/g, "").slice(0, REFERRAL_CODE_LENGTH).toLowerCase();
}

export function extractReferralCode(input: string): string | null {
  const value = input.trim();
  if (!value) return null;

  let candidate = value;
  try {
    const url = new URL(value);
    candidate = url.searchParams.get("ref") ?? value;
  } catch {
    const match = value.match(/[?&]ref=([^&#\s]+)/i);
    if (match?.[1]) {
      try {
        candidate = decodeURIComponent(match[1]);
      } catch {
        candidate = match[1];
      }
    }
  }

  const normalized = candidate.replace(/[^a-z0-9]/gi, "").toLowerCase();
  if (
    normalized.length !== REFERRAL_CODE_LENGTH &&
    normalized.length !== LEGACY_REFERRAL_CODE_LENGTH
  ) {
    return null;
  }

  return normalized;
}

export function referralLinkFor(userId: string): string {
  const configuredBaseUrl = import.meta.env["VITE_REFERRAL_BASE_URL"]?.trim();
  const browserBaseUrl =
    typeof window !== "undefined" &&
    /^https?:$/.test(window.location.protocol) &&
    window.location.hostname !== "localhost"
      ? window.location.origin
      : "";
  const baseUrl = (configuredBaseUrl || browserBaseUrl || "https://blockblast.app").replace(/\/+$/, "");

  return `${baseUrl}/?ref=${referralCodeForUser(userId)}`;
}

/** Нормализация телефона: только цифры, 8XXXXXXXXXX → 7XXXXXXXXXX */
export function normalizePhone(input: string): string {
  let digits = input.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("8")) {
    digits = `7${digits.slice(1)}`;
  }
  return digits;
}

export function formatPhoneDisplay(phone: string): string {
  const p = normalizePhone(phone);
  if (p.length === 11 && p.startsWith("7")) {
    return `+7 (${p.slice(1, 4)}) ${p.slice(4, 7)}-${p.slice(7, 9)}-${p.slice(9)}`;
  }
  return phone;
}

export async function register(
  name: string,
  phone: string,
  password: string,
  referralInput = "",
): Promise<AuthResult> {
  const trimmedName = name.trim();
  const normalized = normalizePhone(phone);
  const referralCode = extractReferralCode(referralInput);

  if (trimmedName.length < 2) return { ok: false, error: "Введите имя (минимум 2 символа)" };
  if (trimmedName.length > 32) return { ok: false, error: "Имя слишком длинное" };
  if (normalized.length < 10 || normalized.length > 15) {
    return { ok: false, error: "Введите корректный номер телефона" };
  }
  if (password.length < 4) return { ok: false, error: "Пароль — минимум 4 символа" };
  if (referralInput.trim() && !referralCode) {
    return { ok: false, error: "Введите корректную реферальную ссылку или код" };
  }

  if (referralCode) {
    const { data: validReferral, error: referralError } = await supabase.rpc(
      "is_referral_code_valid",
      { p_referral_code: referralCode },
    );

    if (referralError) {
      console.error("Referral validation error:", referralError);
      return { ok: false, error: "Не удалось проверить реферальную ссылку" };
    }
    if (!validReferral) {
      return { ok: false, error: "Реферальная ссылка не найдена" };
    }
  }

  const email = `${normalized}@blockblast.app`;

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        name: trimmedName,
        phone: normalized,
        referral_code: referralCode,
      },
    },
  });

  if (error) {
    if (error.message.includes('User already registered')) {
      return { ok: false, error: "Этот номер уже зарегистрирован" };
    }
    return { ok: false, error: error.message };
  }

  if (!data.user) {
    return { ok: false, error: "Ошибка регистрации" };
  }

  // Создаём профиль в таблице profiles
  const { error: profileError } = await supabase
    .from('profiles')
    .insert({
      id: data.user.id,
      name: trimmedName,
      phone: normalized,
      referral_code: referralCodeForUser(data.user.id),
    });

  if (profileError && profileError.code !== "23505") {
    console.error('Profile creation error:', profileError);
  }

  if (referralCode && data.session) {
    const { error: referralError } = await supabase.rpc("apply_referral_code", {
      p_referral_code: referralCode,
    });
    if (referralError) console.error("Referral application error:", referralError);
  }

  return { 
    ok: true, 
    user: { 
      id: data.user.id, 
      name: trimmedName, 
      phone: normalized 
    } 
  };
}

export async function login(phone: string, password: string): Promise<AuthResult> {
  const normalized = normalizePhone(phone);
  if (normalized.length < 10) return { ok: false, error: "Введите номер телефона" };
  if (!password) return { ok: false, error: "Введите пароль" };

  const email = `${normalized}@blockblast.app`;

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    if (error.message === 'Invalid login credentials') {
      return { ok: false, error: "Неверный пароль" };
    }
    return { ok: false, error: error.message };
  }

  if (!data.user) {
    return { ok: false, error: "Ошибка входа" };
  }

  // Получаем данные профиля
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('name, phone')
    .eq('id', data.user.id)
    .single();

  if (profileError || !profile) {
    return { ok: false, error: "Ошибка загрузки профиля" };
  }

  return { 
    ok: true, 
    user: { 
      id: data.user.id, 
      name: profile.name, 
      phone: profile.phone 
    } 
  };
}

export async function getSessionUser(): Promise<AuthUser | null> {
  const { data: { session } } = await supabase.auth.getSession();
  
  if (!session?.user) return null;

  const metadata = session.user.user_metadata as { name?: unknown; phone?: unknown };
  const emailPhone = session.user.email?.split("@", 1)[0] ?? "";
  const cachedPhone = typeof metadata.phone === "string" ? metadata.phone : emailPhone;
  const cachedUser = cachedPhone
    ? {
        id: session.user.id,
        name: typeof metadata.name === "string" ? metadata.name : "Player",
        phone: cachedPhone,
      }
    : null;

  if (typeof navigator !== "undefined" && !navigator.onLine) return cachedUser;

  const { data: profile } = await supabase
    .from('profiles')
    .select('name, phone')
    .eq('id', session.user.id)
    .single();

  if (!profile) return cachedUser;

  return {
    id: session.user.id,
    name: profile.name,
    phone: profile.phone,
  };
}

export async function logout() {
  await supabase.auth.signOut();
}

export function bestKeyFor(userId: string) {
  return userId; // Supabase использует user_id напрямую
}

export function saveKeyFor(userId: string) {
  return userId; // Supabase использует user_id напрямую
}
