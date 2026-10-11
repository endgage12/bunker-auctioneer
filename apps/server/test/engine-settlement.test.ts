// Правила расчёта партии: платит только победитель, компенсация — 10% от его минуса.
//
//  1. Проигравшие НЕ теряют свою ставку (платят только вступительный взнос).
//  2. Победитель в плюсе → остальные ничего не получают, но и не теряют.
//  3. Победитель в минусе (ставка дороже стола) → каждый проигравший получает
//     10% от этого минуса.
import { describe, expect, it } from 'vitest';

import {COMPENSATION_RATE, TIERS} from '@auctioneer/shared';
import { Game } from '../src/game/engine';
import type { EnginePlayerSeed } from '../src/game/engine';
import type { ItemInstance } from '@auctioneer/shared';

/** Фиксированная плата за вход: тесты играют в медном зале */
const ENTRY = TIERS.bronze.entry;

let counter = 0;
function item(value: number): ItemInstance {
  counter++;
  return {
    id: 'comp' + counter,
    defId: 'def',
    name: 'Предмет ' + counter,
    rarity: 'white',
    value,
    w: 1,
    h: 1,
  };
}

function seed(id: string, cash: number): EnginePlayerSeed {
  return { id, name: 'Игрок ' + id, cash, inventory: [] };
}

/** Стол из одного предмета заданной стоимости: так итог партии предсказуем */
function gameWithTable(value: number, players = 4, cash = 5_000_000): Game {
  const seeds = Array.from({ length: players }, (_, i) => seed('p' + i, cash));
  const g = new Game({
    id: 'comp',
    code: 'COMP',
    hostId: seeds[0].id,
    players: seeds,
    now: () => 0,
    tableItems: [item(value)],
  });
  // все внесли взнос, торги начались
  for (const s of seeds) expect(g.confirmEntry(s.id)).toBeNull();
  g.advance();
  return g;
}

/** Провести торги до победы одной ставкой (раунд 5 — «безусловно») */
function bidAll(g: Game, bids: Record<string, number>): void {
  // доводим до фазы приёма ставок 5-го раунда, где побеждает наибольшая ставка
  for (let i = 0; i < 30; i++) {
    const snap = g.snapshot();
    if (snap.auction?.phase === 'bid' && snap.auction.round >= 5) break;
    g.advance();
  }
  const a = g.snapshot().auction;
  expect(a?.round, 'должны дойти до 5-го раунда').toBe(5);
  expect(a?.phase, 'ставки принимаются только в фазе bid').toBe('bid');
  for (const [id, amount] of Object.entries(bids)) {
    expect(g.submitBid(id, amount), 'ставка ' + id + ' должна приняться').toBeNull();
  }
  g.advance(); // bid -> resolve
  g.advance(); // resolve -> finished
}

describe('платит только победитель', () => {
  it('проигравшие не теряют свою ставку (расход — только вступительный взнос)', () => {
    // стол 500 000, победитель в плюсе → компенсации нет, виден чистый расход
    const g = gameWithTable(500_000);
    bidAll(g, { p0: 200_000, p1: 90_000, p2: 80_000, p3: 70_000 });
    const snap = g.snapshot();
    const loser = snap.players.find((p) => p.id === 'p1')!;
    // p1 поставил 90 000, но заплатил только взнос: ставка не списана
    expect(loser.cash).toBe(5_000_000 - ENTRY);
  });

  it('победитель платит ровно свою ставку', () => {
    const g = gameWithTable(100_000);
    bidAll(g, { p0: 220_000, p1: 90_000, p2: 80_000, p3: 70_000 });
    const winner = g.snapshot().players.find((p) => p.id === 'p0')!;
    expect(winner.cash).toBe(5_000_000 - ENTRY - 220_000);
  });

  it('победитель получает все предметы стола', () => {
    const g = gameWithTable(100_000);
    bidAll(g, { p0: 220_000, p1: 90_000, p2: 80_000, p3: 70_000 });
    const report = g.debug();
    const winner = report.players.find((p) => p.id === 'p0')!;
    expect(winner.inventory.length).toBe(1);
    expect(winner.inventory[0].value).toBe(100_000);
  });
});

describe('победитель в плюсе — остальные не получают ничего', () => {
  it('компенсация не начисляется, проигравшие при своих', () => {
    // стол 500 000, ставка 200 000 → победитель в плюсе на 300 000
    const g = gameWithTable(500_000);
    bidAll(g, { p0: 200_000, p1: 90_000, p2: 80_000, p3: 70_000 });
    const snap = g.snapshot();
    for (const id of ['p1', 'p2', 'p3']) {
      const p = snap.players.find((x) => x.id === id)!;
      expect(p.cash).toBe(5_000_000 - ENTRY);
    }
    // банк получил всю ставку без выплат
    expect(g.debug().moneyToBank).toBe(200_000);
  });

  it('в логе сказано, что проигравшие ничего не теряют', () => {
    const g = gameWithTable(500_000);
    bidAll(g, { p0: 200_000, p1: 90_000, p2: 80_000, p3: 70_000 });
    const log = g.snapshot().log.map((e) => e.text).join(' | ');
    expect(log).toContain('в плюсе');
    expect(log).toContain('ничего не получают и ничего не теряют');
  });
});

describe('победитель в минусе — каждому проигравшему 10% от минуса', () => {
  it('пример из правил: минус 120 000 → по 12 000 каждому из троих', () => {
    // стол 100 000, ставка 220 000 → минус 120 000
    const g = gameWithTable(100_000);
    bidAll(g, { p0: 220_000, p1: 90_000, p2: 80_000, p3: 70_000 });
    const snap = g.snapshot();
    const expected = Math.floor(120_000 * COMPENSATION_RATE); // 12 000
    expect(expected).toBe(12_000);
    for (const id of ['p1', 'p2', 'p3']) {
      const p = snap.players.find((x) => x.id === id)!;
      expect(p.cash).toBe(5_000_000 - ENTRY + expected);
    }
    // банк: получил ставку, выплатил 3 × 12 000
    const paid = expected * 3;
    expect(g.debug().moneyToBank).toBe(220_000 - paid);
  });

  it('компенсация не зависит от числа проигравших — она на каждого', () => {
    for (const players of [2, 3, 4]) {
      const g = gameWithTable(100_000, players);
      const bids: Record<string, number> = { p0: 220_000 };
      for (let i = 1; i < players; i++) bids['p' + i] = 50_000 + i * 1_000;
      bidAll(g, bids);
      const snap = g.snapshot();
      const expected = Math.floor(120_000 * COMPENSATION_RATE);
      const losers = snap.players.filter((p) => p.id !== 'p0');
      expect(losers.length).toBe(players - 1);
      for (const l of losers) {
        expect(l.cash).toBe(5_000_000 - ENTRY + expected);
      }
      expect(g.debug().moneyToBank).toBe(220_000 - expected * (players - 1));
    }
  });

  it('ровно на границе (ставка равна столу) компенсации нет', () => {
    const g = gameWithTable(100_000);
    bidAll(g, { p0: 100_000, p1: 90_000, p2: 80_000, p3: 70_000 });
    const snap = g.snapshot();
    for (const id of ['p1', 'p2', 'p3']) {
      expect(snap.players.find((x) => x.id === id)!.cash).toBe(5_000_000 - ENTRY);
    }
    expect(g.debug().moneyToBank).toBe(100_000);
  });

  it('минимальный минус округляется вниз и не создаёт денег из воздуха', () => {
    // стол 100 000, ставка 100 005 → минус 5, 10% = 0.5 → floor = 0
    const g = gameWithTable(100_000);
    bidAll(g, { p0: 100_005, p1: 90_000, p2: 80_000, p3: 70_000 });
    const snap = g.snapshot();
    for (const id of ['p1', 'p2', 'p3']) {
      expect(snap.players.find((x) => x.id === id)!.cash).toBe(5_000_000 - ENTRY);
    }
    const log = g.snapshot().log.map((e) => e.text).join(' | ');
    expect(log).toContain('слишком мала для выплат');
  });

  it('деньги не эмитируются: сумма изменений = −выплаты в банк', () => {
    const startCash = 5_000_000 * 4;
    const tableValue = 100_000;
    const antes = ENTRY * 4;
    const g = gameWithTable(tableValue);
    bidAll(g, { p0: 220_000, p1: 90_000, p2: 80_000, p3: 70_000 });
    const snap = g.snapshot();
    const endCash = snap.players.reduce((sum, p) => sum + p.cash, 0);
    const itemsValue = snap.players.reduce((sum, p) => sum + (p.inventoryValue ?? 0), 0);
    const toBank = g.debug().moneyToBank;
    // Закон сохранения: деньги не появляются из воздуха.
    // Итог = старт + (призовые предметы, созданные движком) − (ушло в банк).
    // В банк ушли взносы всех игроков и ставка победителя за вычетом компенсации.
    expect(endCash + itemsValue).toBe(startCash + tableValue - antes - toBank);
  });
});
