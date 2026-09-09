import { describe, expect, it } from 'vitest';
import { ANTE_MIN, itemsTotal, mulberry32, randomInt } from '@auctioneer/shared';
import { Game } from '../src/game/engine';
import type { EnginePlayerSeed, FinalReport, GameOptions } from '../src/game/engine';
import type { ItemInstance } from '@auctioneer/shared';

let counter = 0;
function item(partial: Partial<ItemInstance> = {}): ItemInstance {
  counter++;
  return { id: 'it' + counter, defId: 'def', name: 'Предмет ' + counter, rarity: 'white', value: 10_000, w: 1, h: 1, ...partial };
}

function seed(id: string, cash: number, items: ItemInstance[]): EnginePlayerSeed {
  return { id, name: 'Игрок ' + id, cash, inventory: items };
}

function makeGame(players: EnginePlayerSeed[], opts: Partial<GameOptions> = {}): Game {
  return new Game({ id: 'g1', code: 'TEST', hostId: players[0].id, players, now: () => 0, ...opts });
}

describe('вступительные ставки', () => {
  it('валидирует суммы и запирает фазу, когда все поставили', () => {
    const g = makeGame([seed('a', 100_000, []), seed('b', 100_000, [])]);
    expect(g.phase).toBe('betting');
    expect(g.submitAnte('a', 0)).not.toBeNull();
    expect(g.submitAnte('a', -5)).not.toBeNull();
    expect(g.submitAnte('a', 1_000_000)).not.toBeNull(); // больше лимита и кошелька
    expect(g.submitAnte('a', 20_000)).toBeNull();
    expect(g.submitAnte('b', 30_000)).toBeNull();
    expect(g.deadline).toBe(0); // все поставили — немедленный лок
    g.advance();
    expect(g.phase).toBe('auction');
    expect(g.debug().pot).toBe(50_000);
    const s = g.snapshot();
    expect(s.players.find((p) => p.id === 'a')?.cash).toBe(80_000);
    expect(s.players.find((p) => p.id === 'b')?.cash).toBe(70_000);
  });

  it('при таймауте ставит минимум автоматически', () => {
    const g = makeGame([seed('a', 100_000, []), seed('b', 100_000, [])]);
    g.submitAnte('a', 20_000);
    g.advance(); // таймаут — b получает ANTE_MIN
    expect(g.phase).toBe('auction');
    expect(g.debug().pot).toBe(20_000 + ANTE_MIN);
    expect(g.snapshot().players.find((p) => p.id === 'b')?.ante).toBe(ANTE_MIN);
  });
});

describe('аукцион', () => {
  it('раунд 1: ставка должна превышать вторую минимум в 2 раза', () => {
    const g = makeGame([seed('a', 100_000, []), seed('b', 100_000, [])]);
    g.submitAnte('a', 10_000);
    g.submitAnte('b', 10_000);
    g.advance(); // лок -> призовой лот, раунд 1
    expect(g.snapshot().auction?.round).toBe(1);
    g.advance(); // reveal -> bid
    expect(g.snapshot().auction?.phase).toBe('bid');
    g.submitBid('a', 100);
    g.submitBid('b', 60);
    g.advance(); // 100 < 2*60 -> следующий раунд
    const s = g.snapshot();
    expect(s.auction?.round).toBe(2);
    expect(s.auction?.phase).toBe('reveal');
    g.advance(); // -> bid
    g.submitBid('a', 200);
    g.submitBid('b', 90);
    g.advance(); // 200*100 >= 160*90 -> победа
    const s2 = g.snapshot();
    expect(s2.auction?.result?.winnerId).toBe('a');
    expect(s2.auction?.result?.price).toBe(200);
    expect(g.moneyToBank).toBe(200);
    expect(s2.players.find((p) => p.id === 'a')?.cash).toBe(100_000 - 10_000 - 200);
  });

  it('граничные ставки считаются точно (без плавающей точки)', () => {
    const g = makeGame([seed('a', 100_000, []), seed('b', 100_000, [])]);
    g.submitAnte('a', 10_000);
    g.submitAnte('b', 10_000);
    g.advance();
    g.advance();
    g.submitBid('a', 100);
    g.submitBid('b', 50); // ровно 2x
    g.advance();
    expect(g.snapshot().auction?.result?.winnerId).toBe('a');
  });

  it('ничья в 5-м раунде -> 6-й раунд -> повторная ничья -> лот сгорает', () => {
    const reports: FinalReport[] = [];
    const g = makeGame([seed('a', 100_000, []), seed('b', 100_000, [])], {
      onFinished: (r) => reports.push(r),
    });
    g.submitAnte('a', 10_000);
    g.submitAnte('b', 10_000);
    g.advance();
    for (let i = 0; i < 6; i++) {
      g.advance(); // reveal -> bid
      g.submitBid('a', 100);
      g.submitBid('b', 100);
      g.advance(); // bid -> resolve
    }
    const s = g.snapshot();
    expect(s.auction?.round).toBe(6);
    expect(s.auction?.result?.voided).toBe(true);
    // предметы сгорели, никому не достались
    const inv = g.debug().players.reduce((sum, p) => sum + p.inventory.length, 0);
    expect(inv).toBe(0);
    expect(g.debug().dropped.length).toBeGreaterThan(0);
    // resolve -> финал партии (отчёт уходит здесь)
    g.advance();
    expect(g.isFinished).toBe(true);
    // в отчёте сгоревшие предметы без владельца
    expect(reports.length).toBe(1);
    expect(reports[0].prizeItems.length).toBe(g.debug().placed.length);
    expect(reports[0].prizeItems.every((it) => it.ownerId === undefined)).toBe(true);
  });
});

describe('финальное раскрытие стола', () => {
  it('при победе в 1-м раунде все предметы раскрываются к концу игры', () => {
    const g = makeGame(
      [seed('a', 100_000, []), seed('b', 100_000, [])],
      { rng: mulberry32(7) },
    );
    g.submitAnte('a', 10_000);
    g.submitAnte('b', 10_000);
    g.advance(); // лок ставок -> стол сгенерирован, раунд 1 (раскрыта лишь часть)
    expect(g.debug().placed.length).toBeGreaterThan(0);
    expect(g.snapshot().items.some((i) => !i.revealed)).toBe(true); // есть скрытые

    g.advance(); // reveal -> bid
    g.submitBid('a', 90_000); // 90 000 >= 2 × 100 — победа уже в 1-м раунде
    g.submitBid('b', 100);
    g.advance(); // bid -> resolve: исход определён, стол раскрыт полностью
    const s1 = g.snapshot();
    expect(s1.auction?.result?.winnerId).toBe('a');
    expect(s1.items.every((i) => i.revealed && i.name !== undefined && i.value !== undefined)).toBe(true);
    expect(s1.board.cells.every((c) => c.kind !== 'closed')).toBe(true);

    g.advance(); // resolve -> финал
    expect(g.isFinished).toBe(true);
    const s2 = g.snapshot();
    expect(s2.items.every((i) => i.revealed)).toBe(true);
    expect(s2.board.cells.every((c) => c.kind !== 'closed')).toBe(true);
    // сумма раскрытого в итогах равна полной стоимости стола
    expect(s2.items.reduce((sum, i) => sum + (i.value ?? 0), 0)).toBe(
      itemsTotal(g.debug().placed.map((pl) => pl.it)),
    );
  });
});

describe('полная игра', () => {
  it('завершается и сохраняет консервацию богатства', () => {
    const rng = mulberry32(42);
    const players: EnginePlayerSeed[] = [
      seed('a', 100_000, [item({ id: 'a1', value: 30_000 }), item({ id: 'a2', value: 15_000 })]),
      seed('b', 100_000, [item({ id: 'b1', value: 25_000 }), item({ id: 'b2', value: 18_000 })]),
    ];
    const wealthStart = players.reduce((s, p) => s + p.cash + itemsTotal(p.inventory), 0);
    const reports: FinalReport[] = [];
    const g = new Game({
      id: 'g-full',
      code: 'FULL',
      hostId: 'a',
      players,
      rng,
      now: () => 0,
      onFinished: (r) => reports.push(r),
    });
    g.submitAnte('a', 20_000);
    g.submitAnte('b', 15_000);
    g.advance(); // лок ставок
    const prizeTotal = itemsTotal(g.debug().placed.map((pl) => pl.it));

    let guard = 0;
    while (!g.isFinished && guard++ < 2000) {
      const snap = g.snapshot();
      if (snap.phase === 'auction' && snap.auction?.phase === 'bid') {
        for (const p of g.debug().players) {
          if (!p.passed && p.bid === null) {
            const roll = rng();
            const amount = roll < 0.15 ? 0 : randomInt(rng, 1, Math.max(1, p.cash));
            g.submitBid(p.id, amount);
          }
        }
        g.advance();
      } else {
        g.advance();
      }
    }

    expect(g.isFinished).toBe(true);
    expect(reports.length).toBe(1);
    const rep = reports[0];
    const wealthEnd = rep.standings.reduce((s, st) => s + st.total, 0);
    const droppedValue = itemsTotal(rep.droppedItems);
    expect(wealthEnd).toBe(wealthStart + prizeTotal - droppedValue - g.moneyToBank - rep.antePot);

    for (const st of rep.standings) expect(st.cash).toBeGreaterThanOrEqual(0);
    for (let i = 1; i < rep.standings.length; i++) {
      expect(rep.standings[i - 1].total).toBeGreaterThanOrEqual(rep.standings[i].total);
    }
    expect(rep.standings[0].playerId).toBe(rep.winnerId);
  });
});

describe('отчёт о партии: вложения и разница', () => {
  it('вложения = вступительная ставка + оплата торгов, разница = итог минус старт', () => {
    const reports: FinalReport[] = [];
    const g = makeGame(
      [
        seed('a', 100_000, [item({ id: 'a1', value: 30_000 })]),
        seed('b', 100_000, [item({ id: 'b1', value: 25_000 })]),
      ],
      { rng: mulberry32(42), onFinished: (r) => reports.push(r) },
    );
    g.submitAnte('a', 10_000);
    g.submitAnte('b', 10_000);
    g.advance(); // лок ставок -> аукцион
    g.advance(); // reveal -> bid
    g.submitBid('a', 5_000); // 5 000 >= 2 × 2 000 — победа в 1-м раунде
    g.submitBid('b', 2_000);
    g.advance(); // bid -> resolve
    expect(g.snapshot().auction?.result?.winnerId).toBe('a');
    g.advance(); // resolve -> финал
    expect(reports.length).toBe(1);
    const rep = reports[0];
    // вложения: победитель заплатил ставку + цену, проигравший — только ставку
    expect(rep.invested['a']).toBe(15_000);
    expect(rep.invested['b']).toBe(10_000);
    // разница: b потерял ровно вступительную ставку, a получил приз за вычетом вложений
    const placedTotal = itemsTotal(g.debug().placed.map((pl) => pl.it));
    expect(rep.profit['a']).toBe(placedTotal - 15_000);
    expect(rep.profit['b']).toBe(-10_000);
    // предметы призового стола в отчёте — с владельцем-победителем
    expect(rep.prizeItems.length).toBe(g.debug().placed.length);
    expect(rep.prizeItems.length).toBeGreaterThan(0);
    expect(rep.prizeItems.every((it) => it.ownerId === 'a')).toBe(true);
  });
});
