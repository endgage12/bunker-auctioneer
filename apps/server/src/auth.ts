// Авторизация: Google OAuth 2.0 (ручной flow) + JWT + dev-login
import { SignJWT, jwtVerify } from 'jose';
import type { NextFunction, Request, Response } from 'express';
import { config } from './config';

const secret = new TextEncoder().encode(config.jwtSecret);

export async function signToken(userId: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(secret);
}

export async function verifyToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, secret);
    return payload.sub ?? null;
  } catch {
    return null;
  }
}

export interface AuthRequest extends Request {
  userId?: string;
}

export function authRequired(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  void verifyToken(token).then((userId) => {
    if (!userId) {
      res.status(401).json({ error: 'Требуется авторизация' });
      return;
    }
    (req as AuthRequest).userId = userId;
    next();
  });
}

// ---------- вход по паролю (личные аккаунты, напр. shlepafloppa) ----------

export interface PasswordAccount {
  /** email аккаунта в БД */
  email: string;
  /** отображаемое имя при первом создании */
  name: string;
  /** пароль из окружения — в клиент не попадает никогда */
  password: string;
}

/** Личные аккаунты с входом по паролю. Пароли читаются только из env. */
export function passwordAccounts(): PasswordAccount[] {
  return [
    {
      email: 'shlepafloppa@auctioneer.local',
      name: 'shlepafloppa',
      password: config.shlepafloppaPassword,
    },
  ];
}

/**
 * Сравнение строк за постоянное время: не даёт подобрать пароль по времени ответа.
 * Длины учитываются отдельно, поэтому утечки длины префикса нет.
 */
export function safeEqual(a: string, b: string): boolean {
  const ab = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  let diff = ab.length ^ bb.length;
  const n = Math.max(ab.length, bb.length);
  for (let i = 0; i < n; i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

interface Attempt {
  count: number;
  /** до какого времени вход заблокирован */
  blockedUntil: number;
  /** время последней неудачи — для сброса счётчика */
  lastFailAt: number;
}

const loginAttempts = new Map<string, Attempt>();

/** после стольких неудач вход временно блокируется */
const MAX_ATTEMPTS = 5;
/** через столько без неудач счётчик сбрасывается */
const ATTEMPT_RESET_MS = 10 * 60_000;
/** базовая пауза; растёт как 2^count, но не больше 5 минут */
const BASE_DELAY_MS = 500;

/**
 * Регистрирует неудачную попытку и возвращает задержку (мс), которую нужно
 * выдержать перед ответом. После MAX_ATTEMPTS пауза становится длинной.
 */
export function registerFailedLogin(key: string, now = Date.now()): number {
  const a = loginAttempts.get(key) ?? { count: 0, blockedUntil: 0, lastFailAt: 0 };
  // давние неудачи не накапливаем
  if (a.lastFailAt && now - a.lastFailAt > ATTEMPT_RESET_MS) a.count = 0;
  a.count += 1;
  a.lastFailAt = now;
  a.blockedUntil = now + Math.min(BASE_DELAY_MS * 2 ** a.count, 5 * 60_000);
  loginAttempts.set(key, a);
  // попутная чистка, чтобы Map не рос бесконечно
  if (loginAttempts.size > 1000) {
    for (const [k, v] of loginAttempts) {
      if (now - v.lastFailAt > ATTEMPT_RESET_MS) loginAttempts.delete(k);
    }
  }
  return Math.max(0, a.blockedUntil - now);
}

export function resetLoginAttempts(key: string): void {
  loginAttempts.delete(key);
}

// ---------- Google OAuth ----------

const oauthStates = new Map<string, number>();

export function googleAuthUrl(): string {
  const state = crypto.randomUUID();
  oauthStates.set(state, Date.now() + 10 * 60_000);
  for (const [k, v] of oauthStates) {
    if (v < Date.now()) oauthStates.delete(k);
  }
  const params = new URLSearchParams({
    client_id: config.googleClientId,
    redirect_uri: config.apiOrigin + '/api/auth/google/callback',
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
  });
  return 'https://accounts.google.com/o/oauth2/v2/auth?' + params.toString();
}

export function consumeOauthState(state: string): boolean {
  const exp = oauthStates.get(state);
  oauthStates.delete(state);
  return !!exp && exp > Date.now();
}

export interface GoogleInfo {
  googleId: string;
  email: string;
  name: string;
  avatar?: string;
}

export async function exchangeGoogleCode(code: string): Promise<GoogleInfo | null> {
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.googleClientId,
      client_secret: config.googleClientSecret,
      redirect_uri: config.apiOrigin + '/api/auth/google/callback',
      grant_type: 'authorization_code',
    }),
  });
  if (!tokenRes.ok) return null;
  const tokenData = (await tokenRes.json()) as { access_token?: string };
  if (!tokenData.access_token) return null;
  const infoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: 'Bearer ' + tokenData.access_token },
  });
  if (!infoRes.ok) return null;
  const info = (await infoRes.json()) as { sub?: string; email?: string; name?: string; picture?: string };
  if (!info.sub || !info.email) return null;
  return { googleId: info.sub, email: info.email, name: info.name ?? info.email, avatar: info.picture };
}
