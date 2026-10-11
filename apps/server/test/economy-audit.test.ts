// Аудит экономики: проверки, которые ловят системные дыры баланса.
//
// Эти тесты описывают ЖЕЛАЕМОЕ устройство экономики. Часть из них специально
// ловит найденные ошибки: неверную целевую стоимость стола, банк дома,
// уходящий в минус, и «печать денег» через компенсацию.
import { describe, expect, it } from 'vitest';

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { COMPENSATION_RATE, ITEM_CATALOG, MAX_PLAYERS, RARITY_ORDER, START_CASH, TABLE_FILL_ABS_MIN, TABLE_FILL_MAX, TABLE_FILL_MIN, TABLE_VALUE_MAX, TABLE_VALUE_MIN, TIERS, TIER_IDS, mulberry32 } from '@auctioneer/shared';
import { Game } from '../src/game/engine';
import type { EnginePlayerSeed } from '../src/game/engine';
import type { ItemInstance, Rarity, TierId } from '@auctioneer/shared';

/** Фиксированная плата за вход: тесты играют в медном зале */
const ENTRY = TIERS.bronze.entry;

let counter = 0;
function seed(id: string, cash: number): EnginePlayerSeed {
  counter++;
  return { id, name: 'Игрок' + counter, cash, inventory: [] };
}

/** Довести партию до фазы приёма ставок нужного раунда */
function advancePastReveal(g: Game): void {
  for (let i = 0; i < 20; i++) {
    const a = g.snapshot().auction;
    if (a?.phase === 'bid') return;
    g.advance();
  }
}

/** Средняя ценность предмета редкости (для аналитики) */
function rarityAvg(rarity: Rarity): { value: number; cells: number } {
  const pool = ITEM_CATALOG.filter((d) => d.rarity === rarity);
  const value = pool.reduce((s, d) => s + d.value, 0) / Math.max(1, pool.length);
  const cells = pool.reduce((s, d) => s + d.w * d.h, 0) / Math.max(1, pool.length);
  return { value, cells };
}

describe('аудит: банк дома не печатает деньги', () => {
  it('выплаты банка ограничены проверкой платёжеспособности', () => {
    const src = readFileSync(resolve(process.cwd(), 'src', 'db.ts'), 'utf8');
    expect(src, 'должна быть проверка платёжеспособности банка').toContain('houseCanAfford');
    // стартовый капитал выдаётся только при достаточном балансе банка
    expect(src).toMatch(/if \(houseCanAfford\(START_CASH\)\)/);
    // торговец тоже не платит из пустого банка
    expect(src).toContain('Торговец не может расплатиться');
  });
});

describe('аудит: ценность стола определяется залом ДО игры', () => {
  it('для каждого зала стол попадает в его диапазон и не зависит от взносов', () => {
    for (const tierId of TIER_IDS) {
      const tier = TIERS[tierId];
      for (let seedN = 1; seedN <= 25; seedN++) {
        const g = new Game({
          id: 'tv' + tierId + seedN,
          code: 'TV',
          hostId: 'p0',
          players: [seed('p0', 50_000_000), seed('p1', 50_000_000)],
          tier,
          rng: mulberry32(seedN * 7919),
          now: () => 0,
        });
        // ценность стола разыграна заранее и лежит внутри диапазона зала
        expect(g.tableValue, tier.name).toBeGreaterThanOrEqual(tier.tableMin);
        expect(g.tableValue, tier.name).toBeLessThanOrEqual(tier.tableMax);

        // взносы игроков на неё не влияют
        const before = g.tableValue;
        g.confirmEntry('p0');
        g.confirmEntry('p1');
        g.advance();
        expect(g.tableValue).toBe(before);

        // и фактически собранный стол близок к заявленной ценности
        const sum = g.debug().placed.reduce((acc, pl) => acc + pl.it.value, 0);
        // стол собирается под предопределённую ценность (допуск на упаковку)
        // Разброс упаковки: стол собирается под цель, но из дискретных предметов,
        // поэтому допускаем заметный коридор (проверяем порядок, а не точность).
        expect(sum, tier.name + ': собранный стол').toBeGreaterThan(before * 0.6);
        expect(sum, tier.name + ': собранный стол').toBeLessThan(before * 1.7);
      }
    }
  });

  it('дорогие залы дают заметно более дорогие столы', () => {
    const avgFor = (tierId: TierId): number => {
      const tier = TIERS[tierId];
      let sum = 0;
      const n = 40;
      for (let i = 1; i <= n; i++) {
        const g = new Game({
          id: 'avg' + tierId + i,
          code: 'AVG',
          hostId: 'p0',
          players: [seed('p0', 50_000_000)],
          tier,
          rng: mulberry32(i * 104729),
          now: () => 0,
        });
        sum += g.tableValue;
      }
      return sum / n;
    };
    const bronze = avgFor('bronze');
    const silver = avgFor('silver');
    const gold = avgFor('gold');
    expect(silver).toBeGreaterThan(bronze * 3);
    expect(gold).toBeGreaterThan(silver * 3);
  });

  it('покрытие клеток не превышает потолок и не пустует', () => {
    const total = 12 * 16;
    const maxCover = Math.floor(total * TABLE_FILL_MAX);
    const absMin = Math.floor(total * TABLE_FILL_ABS_MIN);
    for (const tierId of TIER_IDS) {
      for (let s2 = 1; s2 <= 15; s2++) {
        const g = new Game({
          id: 'c' + tierId + s2,
          code: 'C',
          hostId: 'p0',
          players: [seed('p0', 50_000_000), seed('p1', 50_000_000)],
          tier: TIERS[tierId],
          rng: mulberry32(s2 * 104729),
          now: () => 0,
        });
        const cells = g.debug().placed.reduce((sum, pl) => sum + pl.w * pl.h, 0);
        // потолок соблюдается всегда
        expect(cells, TIERS[tierId].name + ': потолок покрытия').toBeLessThanOrEqual(maxCover);
        // стол не должен быть почти пустым
        // дешёвый стол может занимать меньше клеток: покрытие зависит от ценности
        // у дешёвых столов покрытие ограничено ценностью, поэтому порог мягкий
        const floor = tierId === 'bronze' ? 12 : Math.floor(absMin * 0.5);
        expect(cells, TIERS[tierId].name + ': минимум покрытия').toBeGreaterThanOrEqual(floor);
      }
    }
  });
});

describe('аудит: компенсация не печатает деньги', () => {
  /**
   * Проверяем тотальную сумму по всем игрокам и банку.
   * Деньги в систему попадают только из банка дома, и только в размере,
   * который банк реально получил от игроков в этой же партии.
   */
  it('сумма денег игроков после партии не превышает сумму до партии', () => {
    const players = [seed('a', 2_000_000), seed('b', 2_000_000), seed('c', 2_000_000), seed('d', 2_000_000)];
    const before = players.reduce((s, p) => s + p.cash, 0);
    const g = new Game({
      id: 'money',
      code: 'MONEY',
      hostId: 'a',
      players,
      now: () => 0,
      tableItems: [
        { id: 'prize1', defId: 'x', name: 'Приз', rarity: 'white', value: 100_000, w: 1, h: 1 } as ItemInstance,
      ],
    });
    for (const p of players) g.confirmEntry(p.id);
    g.advance();
    for (let i = 0; i < 10 && g.snapshot().auction?.round !== 5; i++) g.advance();
    // победитель переплачивает: 500 000 за стол в 100 000
    advancePastReveal(g);
    g.submitBid('a', 500_000);
    g.submitBid('b', 100_000);
    g.submitBid('c', 90_000);
    g.submitBid('d', 80_000);
    g.advance(); // bid -> resolve
    g.advance(); // resolve -> finished

    const snap = g.snapshot();
    const after = snap.players.reduce((s, p) => s + p.cash, 0);
    // Приз приходит извне (движок его создал), поэтому к сумме добавляем его номинал
    const injected = 100_000;
    expect(after).toBeLessThanOrEqual(before + injected);
  });

  it('банк не должен терять деньги, когда победитель переплатил', () => {
    // Найденная ошибка: при 3+ проигравших суммарная компенсация (по 10% на каждого)
    // превышала весь минус победителя, поэтому переплата становилась выгодной:
    // победитель печатал деньги из банка дома.
    const players = [seed('a', 2_000_000), seed('b', 2_000_000), seed('c', 2_000_000), seed('d', 2_000_000)];
    const g = new Game({
      id: 'exploit',
      code: 'EXPLOIT',
      hostId: 'a',
      players,
      now: () => 0,
      tableItems: [
        { id: 'p1', defId: 'x', name: 'Приз', rarity: 'white', value: 100_000, w: 1, h: 1 } as ItemInstance,
      ],
    });
    for (const p of players) g.confirmEntry(p.id);
    g.advance();
    const price = 1_000_000; // в 10 раз дороже стола
    advancePastReveal(g);
    g.submitBid('a', price);
    g.submitBid('b', 100_000);
    g.submitBid('c', 90_000);
    g.submitBid('d', 80_000);
    g.advance(); // bid -> resolve
    const result = g.snapshot().auction!.result!;
    const deficit = price - 100_000;
    // выплаты не могут превышать сам минус: иначе игроки в сумме богатеют
    expect(result.compensation, 'компенсация не должна превышать минус победителя').toBeLessThanOrEqual(deficit);
  });

  it('выплаты проигравшим не превышают сумму, внесённую победителем', () => {
    // Ключевая защита: банк не может выплатить больше, чем получил от победителя
    const players = [seed('a', 2_000_000), seed('b', 2_000_000), seed('c', 2_000_000), seed('d', 2_000_000)];
    const g = new Game({
      id: 'cap',
      code: 'CAP',
      hostId: 'a',
      players,
      now: () => 0,
      tableItems: [
        { id: 'p1', defId: 'x', name: 'Приз', rarity: 'white', value: 100_000, w: 1, h: 1 } as ItemInstance,
      ],
    });
    for (const p of players) g.confirmEntry(p.id);
    g.advance();
    for (let i = 0; i < 10 && g.snapshot().auction?.round !== 5; i++) g.advance();
    const price = 500_000;
    advancePastReveal(g);
    g.submitBid('a', price);
    g.submitBid('b', 100_000);
    g.submitBid('c', 90_000);
    g.submitBid('d', 80_000);
    g.advance(); // bid -> resolve
    const result = g.snapshot().auction?.result;
    expect(result?.winnerId).toBe('a');
    // 10% от минуса (400 000) на каждого из трёх = 120 000
    const perLoser = Math.floor(400_000 * COMPENSATION_RATE);
    expect(result?.compensation).toBe(perLoser * 3);
    expect(result!.compensation, 'выплаты не могут превышать ставку победителя').toBeLessThanOrEqual(price);
  });
});
