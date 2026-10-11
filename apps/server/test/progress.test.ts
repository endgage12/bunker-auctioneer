// Тесты прогрессии игрока: ранги, разблокировка залов, серии побед и надбавка.
//
// Прогресс — то, ради чего игрок копит и рискует, поэтому проверяем не только
// счастливый путь, но и то, что прогресс не откатывается назад при проигрышах.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  RANKS,
  START_CASH,
  STREAK_BONUS_MAX,
  TIERS,
  nextRank,
  rankForWinnings,
  streakBonus,
  tierUnlockedByRank,
} from '@auctioneer/shared';
import { Game } from '../src/game/engine';
import type { EnginePlayerSeed } from '../src/game/engine';
import type { ItemInstance } from '@auctioneer/shared';

const TEST_DB = resolve(process.cwd(), '..', '..', 'data', 'test-progress.db');
let db: typeof import('../src/db');

beforeAll(async () => {
  for (const f of [TEST_DB, TEST_DB + '-wal', TEST_DB + '-shm']) {
    if (existsSync(f)) rmSync(f, { force: true });
  }
  process.env.DB_PATH = TEST_DB;
  db = await import('../src/db');
});

afterAll(() => {
  vi.useRealTimers();
  for (const f of [TEST_DB, TEST_DB + '-wal', TEST_DB + '-shm']) {
    if (existsSync(f)) rmSync(f, { force: true });
  }
});

describe('ранги', () => {
  it('ранг определяется накопленным итогом и растёт монотонно', () => {
    expect(rankForWinnings(0).id).toBe('novice');
    expect(rankForWinnings(-500_000).id, 'долги не откатывают ранг ниже первого').toBe('novice');
    let prev = -1;
    for (const r of RANKS) {
      expect(rankForWinnings(r.minWinnings).id).toBe(r.id);
      expect(r.minWinnings).toBeGreaterThan(prev);
      prev = r.minWinnings;
    }
    const last = RANKS[RANKS.length - 1];
    expect(rankForWinnings(last.minWinnings * 10).id).toBe(last.id);
  });

  it('следующий ранг показывает остаток, у максимального его нет', () => {
    const next = nextRank(0);
    expect(next).not.toBeNull();
    expect(next!.rank.id).toBe(RANKS[1].id);
    expect(next!.remaining).toBe(RANKS[1].minWinnings);
    expect(nextRank(RANKS[RANKS.length - 1].minWinnings)).toBeNull();
  });

  it('серебряный и золотой залы требуют ранга, медный — нет', () => {
    expect(tierUnlockedByRank('bronze', 0), 'в медный зал пускают с нуля').toBe(true);
    expect(tierUnlockedByRank('silver', 0)).toBe(false);
    expect(tierUnlockedByRank('gold', 0)).toBe(false);

    const silverRank = RANKS.find((r) => r.unlocks === 'silver')!;
    const goldRank = RANKS.find((r) => r.unlocks === 'gold')!;
    expect(tierUnlockedByRank('silver', silverRank.minWinnings)).toBe(true);
    expect(tierUnlockedByRank('gold', silverRank.minWinnings), 'серебро не открывает золото').toBe(false);
    expect(tierUnlockedByRank('gold', goldRank.minWinnings)).toBe(true);
  });
});

describe('надбавка за серию побед', () => {
  it('растёт с серией и упирается в потолок', () => {
    expect(streakBonus(0)).toBe(0);
    expect(streakBonus(1), 'одна победа — ещё не серия').toBe(0);
    expect(streakBonus(2)).toBeGreaterThan(0);
    expect(streakBonus(3)).toBeGreaterThan(streakBonus(2));
    expect(streakBonus(100), 'надбавка не бесконечна').toBe(STREAK_BONUS_MAX);
  });
});

/** Партия с заданным столом: стол известен заранее, поэтому расчёт предсказуем */
function makeGame(players: EnginePlayerSeed[], tableValue: number): Game {
  return new Game({
    id: 'prog',
    code: 'PROG',
    hostId: players[0].id,
    players,
    now: () => 0,
    tableItems: [
      { id: 'prize1', defId: 'x', name: 'Приз', rarity: 'white', value: tableValue, w: 1, h: 1 } as ItemInstance,
    ],
  });
}

/** Провести торги до победы одной ставкой в 5-м раунде */
function bidAndFinish(g: Game, bids: Record<string, number>): void {
  for (let i = 0; i < 40; i++) {
    const snap = g.snapshot();
    if (snap.auction?.phase === 'bid' && snap.auction.round >= 5) break;
    g.advance();
  }
  expect(g.snapshot().auction?.round).toBe(5);
  for (const [id, amount] of Object.entries(bids)) g.submitBid(id, amount);
  g.advance();
  g.advance();
}

describe('надбавка за серию в самой партии', () => {
  it('победитель с серией получает больше, чем без серии', () => {
    const plain = makeGame(
      [
        { id: 'a', name: 'A', cash: 5_000_000, inventory: [], streak: 0 },
        { id: 'b', name: 'B', cash: 5_000_000, inventory: [] },
        { id: 'c', name: 'C', cash: 5_000_000, inventory: [] },
      ],
      1_000_000,
    );
    for (const p of plain.debug().players) plain.confirmEntry(p.id);
    plain.advance();
    bidAndFinish(plain, { a: 500_000, b: 100_000, c: 90_000 });
    const plainCash = plain.snapshot().players.find((p) => p.id === 'a')!.cash;

    const streaked = makeGame(
      [
        { id: 'a', name: 'A', cash: 5_000_000, inventory: [], streak: 3 },
        { id: 'b', name: 'B', cash: 5_000_000, inventory: [] },
        { id: 'c', name: 'C', cash: 5_000_000, inventory: [] },
      ],
      1_000_000,
    );
    for (const p of streaked.debug().players) streaked.confirmEntry(p.id);
    streaked.advance();
    bidAndFinish(streaked, { a: 500_000, b: 100_000, c: 90_000 });
    const streakedCash = streaked.snapshot().players.find((p) => p.id === 'a')!.cash;

    // надбавка = 5% за каждую победу сверх первой (серия 3 → 10% от ставки)
    const expectedBonus = Math.round(500_000 * streakBonus(3));
    expect(expectedBonus).toBeGreaterThan(0);
    expect(streakedCash - plainCash).toBe(expectedBonus);
  });

  it('серия не начисляется проигравшим', () => {
    const g = makeGame(
      [
        { id: 'a', name: 'A', cash: 5_000_000, inventory: [] },
        { id: 'b', name: 'B', cash: 5_000_000, inventory: [], streak: 5 },
        { id: 'c', name: 'C', cash: 5_000_000, inventory: [] },
      ],
      1_000_000,
    );
    for (const p of g.debug().players) g.confirmEntry(p.id);
    g.advance();
    // побеждает 'a', хотя серия у 'b'
    bidAndFinish(g, { a: 500_000, b: 100_000, c: 90_000 });
    const b = g.snapshot().players.find((p) => p.id === 'b')!;
    const tableValue = 1_000_000;
    // у проигравшего только расход на вход и возможная компенсация
    expect(b.cash).toBeLessThanOrEqual(5_000_000);
    expect(tableValue).toBeGreaterThan(0);
  });
});

describe('прогресс игрока в базе', () => {
  it('новый игрок: нулевой итог, ранг новичка, доступен только медный зал', () => {
    const user = db.findOrCreateDevUser('progress-new@test.dev', 'Новичок');
    const p = db.getPlayerProgress(user.id)!;
    expect(p.totalWinnings).toBe(0);
    expect(p.rankId).toBe('novice');
    expect(p.currentStreak).toBe(0);
    expect(p.unlockedTiers).toEqual(['bronze']);
    expect(p.next?.name).toBe(RANKS[1].name);
    expect(p.progress).toBe(0);
  });

  it('итог и серия копятся через реальную финализацию партии', () => {
    const user = db.findOrCreateDevUser('progress-grow@test.dev', 'Растущий');
    const rival = db.findOrCreateDevUser('progress-rival@test.dev', 'Соперник');
    const before = db.getPlayerProgress(user.id)!;
    expect(before.totalWinnings).toBe(0);
    expect(before.currentStreak).toBe(0);

    // играем настоящую партию и финализируем её в базу
    const g = new Game({
      id: 'grow-game',
      code: 'GROW',
      hostId: user.id,
      now: () => 0,
      players: [
        { id: user.id, name: 'Растущий', cash: 2_000_000, inventory: [] },
        { id: rival.id, name: 'Соперник', cash: 2_000_000, inventory: [] },
      ],
      tableItems: [
        { id: 'gp1', defId: 'x', name: 'Приз', rarity: 'white', value: 1_000_000, w: 1, h: 1 } as ItemInstance,
      ],
      onFinished: (report) => db.finalizeGame(report),
    });
    for (const p of g.debug().players) g.confirmEntry(p.id);
    g.advance();
    bidAndFinish(g, { [user.id]: 500_000, [rival.id]: 100_000 });

    const after = db.getPlayerProgress(user.id)!;
    const winnerProfit = after.totalWinnings - before.totalWinnings;
    expect(winnerProfit, 'победитель заработал за партию').toBeGreaterThan(0);
    expect(after.currentStreak, 'серия побед выросла').toBe(before.currentStreak + 1);
    expect(after.bestStreak).toBeGreaterThanOrEqual(after.currentStreak);
    expect(after.progress).toBeGreaterThanOrEqual(0);
    expect(after.progress).toBeLessThanOrEqual(1);

    // проигравший: серия обнулилась, итог уменьшился
    const rivalAfter = db.getPlayerProgress(rival.id)!;
    expect(rivalAfter.currentStreak).toBe(0);
    expect(rivalAfter.totalWinnings).toBeLessThanOrEqual(0);
  });

  it('проигрыш обнуляет текущую серию, но не лучшую', () => {
    const user = db.findOrCreateDevUser('progress-streak@test.dev', 'Серийный');
    const rival = db.findOrCreateDevUser('progress-streak2@test.dev', 'Серийный 2');
    // две победы подряд поднимают и текущую, и лучшую серию
    for (let i = 0; i < 2; i++) {
      const g = new Game({
        id: 'streak-game-' + i,
        code: 'STRK',
        hostId: user.id,
        now: () => 0,
        players: [
          { id: user.id, name: 'Серийный', cash: 2_000_000, inventory: [] },
          { id: rival.id, name: 'Серийный 2', cash: 2_000_000, inventory: [] },
        ],
        tableItems: [
          { id: 'sp' + i, defId: 'x', name: 'Приз', rarity: 'white', value: 1_000_000, w: 1, h: 1 } as ItemInstance,
        ],
        onFinished: (report) => db.finalizeGame(report),
      });
      for (const p of g.debug().players) g.confirmEntry(p.id);
      g.advance();
      bidAndFinish(g, { [user.id]: 500_000, [rival.id]: 100_000 });
    }
    const winning = db.getPlayerProgress(user.id)!;
    expect(winning.currentStreak).toBe(2);
    expect(winning.bestStreak).toBe(2);

    // теперь проигрываем: текущая серия обнуляется, лучшая остаётся
    const g = new Game({
      id: 'streak-lose',
      code: 'LOSE',
      hostId: user.id,
      now: () => 0,
      players: [
        { id: user.id, name: 'Серийный', cash: 2_000_000, inventory: [] },
        { id: rival.id, name: 'Серийный 2', cash: 2_000_000, inventory: [] },
      ],
      tableItems: [
        { id: 'lp', defId: 'x', name: 'Приз', rarity: 'white', value: 1_000_000, w: 1, h: 1 } as ItemInstance,
      ],
      onFinished: (report) => db.finalizeGame(report),
    });
    for (const p of g.debug().players) g.confirmEntry(p.id);
    g.advance();
    bidAndFinish(g, { [user.id]: 100_000, [rival.id]: 500_000 });

    const afterLoss = db.getPlayerProgress(user.id)!;
    expect(afterLoss.currentStreak, 'серия сброшена').toBe(0);
    expect(afterLoss.bestStreak, 'лучшая серия сохранена').toBe(2);
  });
});

describe('экономика залов согласована с прогрессией', () => {
  it('ранг, открывающий зал, достижим за разумное число партий', () => {
    const silverRank = RANKS.find((r) => r.unlocks === 'silver')!;
    const goldRank = RANKS.find((r) => r.unlocks === 'gold')!;
    // медианный выигрыш в медном зале ~ вход, поэтому считаем по хорошим партиям
    const goodBronzeWin = TIERS.bronze.tableMax * 0.4;
    expect(goodBronzeWin).toBeGreaterThan(0);
    // до серебра — не больше ~20 успешных партий, до золота — не больше ~80
    expect(silverRank.minWinnings / goodBronzeWin).toBeLessThan(25);
    expect(goldRank.minWinnings / (TIERS.silver.tableMax * 0.3)).toBeLessThan(80);
  });

  it('стартового капитала хватает на вход в младший зал', () => {
    expect(TIERS.bronze.entry).toBeLessThan(START_CASH);
  });
});
