import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url)); // apps/server/src
const root = resolve(here, '../../..');

function loadEnvFile() {
  const p = resolve(root, '.env');
  if (!existsSync(p)) return;
  const text = readFileSync(p, 'utf8');
  const lines = text.split(/[\r\n]+/);
  for (const line of lines) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}
loadEnvFile();

export const config = {
  root,
  port: Number(process.env.PORT ?? 3000),
  webOrigin: process.env.WEB_ORIGIN ?? 'http://localhost:5173',
  apiOrigin: process.env.API_ORIGIN ?? 'http://localhost:3000',
  jwtSecret: process.env.JWT_SECRET ?? 'dev-secret-change-me',
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
  allowDevLogin: (process.env.ALLOW_DEV_LOGIN ?? 'true') === 'true',
  /**
   * Пароль личного аккаунта shlepafloppa (кнопка «Войти как shlepafloppa»).
   * Проверяется только на сервере — в клиентский бандл пароль не попадает.
   */
  shlepafloppaPassword: process.env.SHLEPAFLOPPA_PASSWORD ?? 'zasq12',
  /** почты (через запятую), которым выдаются права администратора банка дома */
  adminEmails: (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
  /** стартовый капитал банка дома */
  houseStartBalance: Number(process.env.HOUSE_START_BALANCE ?? 10_000_000),
  dbPath: resolve(root, process.env.DB_PATH ?? 'data/auctioneer.db'),
  gameTimings: {
    betting: Number(process.env.GAME_BETTING_SECONDS ?? 60),
    reveal: Number(process.env.GAME_REVEAL_SECONDS ?? 7),
    bid: Number(process.env.GAME_BID_SECONDS ?? 45),
    resolve: Number(process.env.GAME_RESOLVE_SECONDS ?? 8),
  },
};
