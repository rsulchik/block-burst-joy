export type AuthUser = {
  id: string;
  name: string;
  phone: string;
};

type StoredUser = AuthUser & {
  salt: string;
  passwordHash: string;
  createdAt: number;
};

const USERS_KEY = "blockblast_users";
const SESSION_KEY = "blockblast_session";

function loadUsers(): StoredUser[] {
  try {
    const raw = localStorage.getItem(USERS_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw) as StoredUser[];
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function saveUsers(users: StoredUser[]) {
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
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

function randomSalt(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function hashPassword(password: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${password}`);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

function publicUser(u: StoredUser): AuthUser {
  return { id: u.id, name: u.name, phone: u.phone };
}

export function getSessionUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw) as { userId: string };
    const user = loadUsers().find((u) => u.id === session.userId);
    return user ? publicUser(user) : null;
  } catch {
    return null;
  }
}

function setSession(userId: string) {
  localStorage.setItem(SESSION_KEY, JSON.stringify({ userId }));
}

export function logout() {
  localStorage.removeItem(SESSION_KEY);
}

export type AuthResult = { ok: true; user: AuthUser } | { ok: false; error: string };

export async function register(name: string, phone: string, password: string): Promise<AuthResult> {
  const trimmedName = name.trim();
  const normalized = normalizePhone(phone);

  if (trimmedName.length < 2) return { ok: false, error: "Введите имя (минимум 2 символа)" };
  if (trimmedName.length > 32) return { ok: false, error: "Имя слишком длинное" };
  if (normalized.length < 10 || normalized.length > 15) {
    return { ok: false, error: "Введите корректный номер телефона" };
  }
  if (password.length < 4) return { ok: false, error: "Пароль — минимум 4 символа" };

  const users = loadUsers();
  if (users.some((u) => u.phone === normalized)) {
    return { ok: false, error: "Этот номер уже зарегистрирован" };
  }

  const salt = randomSalt();
  const passwordHash = await hashPassword(password, salt);
  const user: StoredUser = {
    id: crypto.randomUUID(),
    name: trimmedName,
    phone: normalized,
    salt,
    passwordHash,
    createdAt: Date.now(),
  };
  users.push(user);
  saveUsers(users);
  setSession(user.id);
  return { ok: true, user: publicUser(user) };
}

export async function login(phone: string, password: string): Promise<AuthResult> {
  const normalized = normalizePhone(phone);
  if (normalized.length < 10) return { ok: false, error: "Введите номер телефона" };
  if (!password) return { ok: false, error: "Введите пароль" };

  const user = loadUsers().find((u) => u.phone === normalized);
  if (!user) return { ok: false, error: "Аккаунт не найден. Зарегистрируйтесь" };

  const hash = await hashPassword(password, user.salt);
  if (hash !== user.passwordHash) return { ok: false, error: "Неверный пароль" };

  setSession(user.id);
  return { ok: true, user: publicUser(user) };
}

export function bestKeyFor(userId: string) {
  return `blockblast_best_${userId}`;
}

export function saveKeyFor(userId: string) {
  return `blockblast_save_${userId}`;
}
