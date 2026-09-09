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

    const top = db.getLeaderboard(1, 30, c.id);
    expect(top.entries.length).toBe(3);
    expect(top.entries[0].id).toBe(a.id);
    expect(top.entries[1].id).toBe(b.id);
    expect(top.entries[2].id).toBe(c.id);
    expect(top.total).toBe(3);
    expect(top.page).toBe(1);
    expect(top.pageSize).toBe(30);
    expect(top.totalPages).toBe(1);

    // у каждого игрока своё место в списке
    top.entries.forEach((e, i) => expect(e.rank).toBe(i + 1));

    // счёт = наличные + номинал инвентаря
    for (const e of top.entries) {
      expect(e.netWorth).toBe(e.cash + e.inventoryValue);
    }

    // дом (банк) в таблицу не попадает
    expect(top.entries.some((e) => e.id === 'house')).toBe(false);

    // пагинация: по 2 на страницу — первая страница (топ-2)
    const p1 = db.getLeaderboard(1, 2, c.id);
    expect(p1.entries.length).toBe(2);
    expect(p1.entries[0].rank).toBe(1);
    expect(p1.entries[1].rank).toBe(2);
    expect(p1.total).toBe(3);
    expect(p1.totalPages).toBe(2);
    expect(p1.page).toBe(1);

    // вторая страница: только третий игрок, ранги сквозные
    const p2 = db.getLeaderboard(2, 2, c.id);
    expect(p2.entries.length).toBe(1);
    expect(p2.entries[0].id).toBe(c.id);
    expect(p2.entries[0].rank).toBe(3);
    expect(p2.page).toBe(2);

    // ограничение топа: своё место (3-е) возвращается отдельно
    expect(p1.me).not.toBeNull();
    expect(p1.me!.id).toBe(c.id);
    expect(p1.me!.rank).toBe(3);

    // чужой игрок видит своё место в середине списка
    const forB = db.getLeaderboard(1, 1, b.id);
    expect(forB.entries[0].id).toBe(a.id);
    expect(forB.me!.id).toBe(b.id);
    expect(forB.me!.rank).toBe(2);

    // запрос страницы за пределами таблицы зажимается на последнюю
    const clamp = db.getLeaderboard(99, 2, c.id);
    expect(clamp.page).toBe(2);
    expect(clamp.entries.length).toBe(1);
  });
});
