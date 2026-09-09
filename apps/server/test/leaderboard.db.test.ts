// Тесты БД-уровня для таблицы лидеров: топ по «счёту», ранги, своё место вне топа.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

// cwd vitest — apps/server; БД кладём в data/ корня репозитория
const TEST_DB = resolve(process.cwd(), '..', '..', 'data', 'test-leaderboard.db');

let db: typeof import('../src/db');

beforeAll(async () => {
  for (const f of [TEST_DB, TEST_DB + '-wal', TEST_DB + '-shm']) {
    if (existsSync(f)) rmSync(f, { force: true });
  }
  process.env.DB_PATH = TEST_DB;
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));
  db = await import('../src/db');
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(() => {
  vi.useRealTimers();
});

describe('таблица лидеров', () => {
  it('топ по счёту: ранги подряд, дом исключён, своё место видно вне топа', () => {
    const a = db.findOrCreateDevUser('lb-a@test.dev', 'Альфа');
    const b = db.findOrCreateDevUser('lb-b@test.dev', 'Бета');
    const c = db.findOrCreateDevUser('lb-c@test.dev', 'Гамма');

    // стартовые наборы случайны (в пределах ~1.1 млн), поэтому разница в миллионы
    // делает порядок детерминированным: a > b > c
    expect(db.transferFromBank('admin', 'lb-a@test.dev', 10_000_000).ok).toBe(true);
    expect(db.transferFromBank('admin', 'lb-b@test.dev', 5_000_000).ok).toBe(true);
    expect(db.transferFromBank('admin', 'lb-c@test.dev', 1_000_000).ok).toBe(true);

    const top = db.getLeaderboard(50, c.id);
    expect(top.entries.length).toBe(3);
    expect(top.entries[0].id).toBe(a.id);
    expect(top.entries[1].id).toBe(b.id);
    expect(top.entries[2].id).toBe(c.id);

    // у каждого игрока своё место в списке
    top.entries.forEach((e, i) => expect(e.rank).toBe(i + 1));

    // счёт = наличные + номинал инвентаря
    for (const e of top.entries) {
      expect(e.netWorth).toBe(e.cash + e.inventoryValue);
    }

    // дом (банк) в таблицу не попадает
    expect(top.entries.some((e) => e.id === 'house')).toBe(false);

    // ограничение топа: своё место (3-е) возвращается отдельно
    const short = db.getLeaderboard(2, c.id);
    expect(short.entries.length).toBe(2);
    expect(short.me).not.toBeNull();
    expect(short.me!.id).toBe(c.id);
    expect(short.me!.rank).toBe(3);

    // чужой игрок видит своё место в середине списка
    const forB = db.getLeaderboard(1, b.id);
    expect(forB.entries[0].id).toBe(a.id);
    expect(forB.me!.id).toBe(b.id);
    expect(forB.me!.rank).toBe(2);
  });
});
