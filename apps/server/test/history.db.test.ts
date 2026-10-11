// Тесты БД-уровня для истории матчей: запись итогов партии и выборка истории
// (вложения и разница по каждой партии). Используется отдельная тестовая БД.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import {mulberry32} from '@auctioneer/shared';
import { Game } from '../src/game/engine';
import type { FinalReport } from '../src/game/engine';

// cwd vitest — apps/server; БД кладём в data/ корня репозитория
const TEST_DB = resolve(process.cwd(), '..', '..', 'data', 'test-history.db');

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

afterAll(() => {
  vi.useRealTimers();
});

describe('История матчей: хранилище', () => {
  it('завершённая партия попадает в историю с вложениями и разницей', () => {
    const a = db.findOrCreateDevUser('hist-a@test.dev', 'ИгрокА');
    const b = db.findOrCreateDevUser('hist-b@test.dev', 'ИгрокБ');

    const reports: FinalReport[] = [];
    const g = new Game({
      id: crypto.randomUUID(),
      code: 'HIST',
      hostId: a.id,
      players: [
        { id: a.id, name: a.name, cash: 100_000, inventory: [] },
        { id: b.id, name: b.name, cash: 100_000, inventory: [] },
      ],
      rng: mulberry32(7),
      now: () => Date.now(),
      onFinished: (r) => reports.push(r),
    });
    g.confirmEntry(a.id);
    g.confirmEntry(b.id);
    g.advance(); // лок ставок
    g.advance(); // reveal -> bid
    g.submitBid(a.id, 5_000); // победа в 1-м раунде (5 000 >= 2 × 2 000)
    g.submitBid(b.id, 2_000);
    g.advance(); // bid -> resolve
    g.advance(); // resolve -> финал
    expect(reports.length).toBe(1);

    db.finalizeGame(reports[0]);
    const rep = reports[0];

    const histA = db.getMatchHistory(a.id);
    expect(histA).toHaveLength(1);
    expect(histA[0].code).toBe('HIST');
    expect(histA[0].players).toBe(2);
    expect(histA[0].place).toBe(1);
    expect(histA[0].winnerId).toBe(a.id);
    expect(histA[0].invested).toBe(15_000); // ставка 10k + цена 5k
    expect(histA[0].profit).toBe(rep.profit[a.id]);

    const histB = db.getMatchHistory(b.id);
    expect(histB).toHaveLength(1);
    expect(histB[0].place).toBe(2);
    expect(histB[0].invested).toBe(10_000); // только вступительная ставка
    expect(histB[0].profit).toBe(-10_000);

    // счётчик игр и побед в профиле обновился
    expect(db.getPublicProfile(a.id)!.gamesPlayed).toBe(1);
    expect(db.getPublicProfile(a.id)!.gamesWon).toBe(1);

    // детализация матча: участники и предметы стола с владельцем
    const detail = db.getGameDetail(rep.gameId);
    expect(detail).not.toBeNull();
    expect(detail!.code).toBe('HIST');
    expect(detail!.winnerId).toBe(a.id);
    expect(detail!.players).toHaveLength(2);
    expect(detail!.items).toHaveLength(rep.prizeItems.length);
    expect(detail!.items.length).toBeGreaterThan(0);
    expect(detail!.items.every((it) => it.ownerId === a.id)).toBe(true);
    expect(detail!.items[0].name.length).toBeGreaterThan(0);
    expect(typeof detail!.items[0].value).toBe('number');
    // несуществующий матч
    expect(db.getGameDetail('no-such-game')).toBeNull();
  });

  it('история отсортирована от новых партий к старым', () => {
    const a = db.findOrCreateDevUser('hist-sort@test.dev', 'ИгрокСорт');
    const b = db.findOrCreateDevUser('hist-sort-b@test.dev', 'ИгрокСортБ');
    for (let i = 0; i < 3; i++) {
      const reports: FinalReport[] = [];
      const g = new Game({
        id: crypto.randomUUID(),
        code: 'S' + i,
        hostId: a.id,
        players: [
          { id: a.id, name: a.name, cash: 100_000, inventory: [] },
          { id: b.id, name: b.name, cash: 100_000, inventory: [] },
        ],
        rng: mulberry32(11 + i),
        now: () => Date.now(),
        onFinished: (r) => reports.push(r),
      });
      g.confirmEntry(a.id);
      g.confirmEntry(b.id);
      g.advance();
      g.advance();
      g.submitBid(a.id, 5_000);
      g.submitBid(b.id, 2_000);
      g.advance();
      g.advance();
      db.finalizeGame(reports[0]);
      vi.setSystemTime(new Date(Date.now() + 60_000));
    }
    const hist = db.getMatchHistory(a.id);
    expect(hist).toHaveLength(3);
    expect(hist.map((h) => h.code)).toEqual(['S2', 'S1', 'S0']);
  });
});
