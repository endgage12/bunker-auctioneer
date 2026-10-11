// Тесты итоговой таблицы партии.
//
// Игрок должен видеть РЕЗУЛЬТАТ партии, а не нетто-состояние: раньше в таблице
// показывались «наличные + инвентарь», из-за чего победитель с профитом 103 108
// выглядел как владелец 753 608, а проигравшие — как люди с деньгами, хотя
// каждый потерял входной взнос.
import { describe, expect, it } from 'vitest';
import { mulberry32, TIERS } from '@auctioneer/shared';
import type { ItemInstance } from '@auctioneer/shared';
import { Game } from '../src/game/engine';
import type { EnginePlayerSeed } from '../src/game/engine';

function item(id: string, value: number): ItemInstance {
  return { id, defId: 'x', name: 'Приз ' + id, rarity: 'white', value, w: 1, h: 1 } as ItemInstance;
}

function makeGame(players: EnginePlayerSeed[], tableValue: number, tier = TIERS.bronze): Game {
  return new Game({
    id: 'final-' + Math.random().toString(36).slice(2, 8),
    code: 'FIN',
    hostId: players[0].id,
    players,
    now: () => 0,
    rng: mulberry32(12345),
    tier,
    tableItems: [item('prize', tableValue)],
  });
}

/**
 * Довести партию до конца: подтвердить вход, проставить ставки в финальном
 * раунде и прокрутить партию до фазы finished.
 *
 * Важно: при ничьей движок назначает дополнительный раунд, поэтому фиксированное
 * число шагов не подходит — ждём именно фазу finished.
 */
function playToEnd(g: Game, bids: Record<string, number>): void {
  for (const p of g.debug().players) g.confirmEntry(p.id);
  g.advance();
  for (let i = 0; i < 60; i++) {
    const snap = g.snapshot();
    if (snap.auction?.phase === 'bid' && snap.auction.round >= 5) break;
    g.advance();
  }
  expect(g.snapshot().auction?.round, 'дошли до финального раунда').toBe(5);
  for (const [id, amount] of Object.entries(bids)) g.submitBid(id, amount);
  advanceUntilFinished(g);
}

/** Прокручивает партию до финального экрана (не больше 20 шагов) */
function advanceUntilFinished(g: Game): void {
  for (let i = 0; i < 20; i++) {
    if (g.snapshot().phase === 'finished') return;
    g.advance();
  }
  expect(g.snapshot().phase, 'партия дошла до финала').toBe('finished');
}

describe('итоговая таблица: профит вместо состояния', () => {
  it('профит победителя = ценность стола минус его ставка', () => {
    const stake = 70_750;
    const tableValue = 173_858;
    const g = makeGame(
      [
        { id: 'a', name: 'Победитель', cash: 280_000, inventory: [] },
        { id: 'b', name: 'Б', cash: 54_722, inventory: [] },
        { id: 'c', name: 'В', cash: 57_656, inventory: [] },
        { id: 'd', name: 'Г', cash: 68_047, inventory: [] },
      ],
      tableValue,
    );
    playToEnd(g, { a: stake, b: 10_000, c: 10_000, d: 10_000 });

    const fin = g.snapshot().final!;
    const a = fin.standings.find((s) => s.playerId === 'a')!;

    // Ценность стола фиксируется по факту и совпадает с тем, что получил игрок
    expect(fin.auction!.tableValue, 'ценность стола = сумма предметов').toBe(tableValue);
    // Профит победителя: забрал стол, заплатил ставку и вход в зал
    expect(a.profit, 'профит победителя').toBe(tableValue - stake - TIERS.bronze.entry);
    // Вход уже вычтен из наличных, поэтому профит его учитывает
    // вложено = вход в зал + оплата выигранных торгов
    expect(a.spent, 'вложено = вход + ставка').toBe(stake + TIERS.bronze.entry);
    // полученный предмет учтён в инвентаре
    expect(a.inventoryGained).toBe(tableValue);
    // нетто-состояние на финише = старт + профит
    expect(a.total).toBe(a.startTotal + a.profit);
  });

  it('проигравшие теряют ровно вход, а не «показывают деньги»', () => {
    const g = makeGame(
      [
        { id: 'a', name: 'Победитель', cash: 280_000, inventory: [] },
        { id: 'b', name: 'Б', cash: 54_722, inventory: [] },
        { id: 'c', name: 'В', cash: 57_656, inventory: [] },
      ],
      173_858,
    );
    playToEnd(g, { a: 70_750, b: 10_000, c: 10_000 });

    const fin = g.snapshot().final!;
    for (const id of ['b', 'c']) {
      const s = fin.standings.find((x) => x.playerId === id)!;
      // при победе покупателя в плюсе компенсации нет: теряется только вход
      expect(s.profit, 'профит проигравшего ' + id).toBe(-TIERS.bronze.entry);
      expect(s.spent).toBe(TIERS.bronze.entry);
      expect(s.inventoryGained).toBe(0);
      expect(s.total).toBe(s.startTotal - TIERS.bronze.entry);
    }
  });

  it('переплативший получает компенсацию, и профит её учитывает', () => {
    const overpay = 400_000;
    const tableValue = 100_000;
    const g = makeGame(
      [
        { id: 'a', name: 'Транжира', cash: 2_000_000, inventory: [] },
        { id: 'b', name: 'Б', cash: 2_000_000, inventory: [] },
        { id: 'c', name: 'В', cash: 2_000_000, inventory: [] },
      ],
      tableValue,
    );
    playToEnd(g, { a: overpay, b: 50_000, c: 50_000 });

    const fin = g.snapshot().final!;
    const a = fin.standings.find((s) => s.playerId === 'a')!;
    const b = fin.standings.find((s) => s.playerId === 'b')!;

    // победитель в минусе: заплатил больше, чем стоит стол
    expect(a.profit).toBeLessThan(0);
    // компенсация делится поровну между проигравшими
    expect(fin.auction!.perLoserCompensation).toBeGreaterThan(0);
    expect(b.profit).toBe(-TIERS.bronze.entry + fin.auction!.perLoserCompensation);
  });

  it('итоги торгов попадают в финальный снимок', () => {
    const g = makeGame(
      [
        { id: 'a', name: 'А', cash: 500_000, inventory: [] },
        { id: 'b', name: 'Б', cash: 500_000, inventory: [] },
      ],
      200_000,
    );
    playToEnd(g, { a: 150_000, b: 20_000 });

    const fin = g.snapshot().final!;
    expect(fin.auction, 'итоги торгов есть').toBeDefined();
    expect(fin.auction!.winnerId).toBe('a');
    expect(fin.auction!.price).toBe(150_000);
    expect(fin.auction!.tableValue).toBe(200_000);
    expect(fin.auction!.voided).toBe(false);
  });

  it('сумма профитов не превышает то, что забрал банк дома', () => {
    const g = makeGame(
      [
        { id: 'a', name: 'А', cash: 900_000, inventory: [] },
        { id: 'b', name: 'Б', cash: 900_000, inventory: [] },
        { id: 'c', name: 'В', cash: 900_000, inventory: [] },
      ],
      300_000,
    );
    playToEnd(g, { a: 250_000, b: 30_000, c: 20_000 });
    const fin = g.snapshot().final!;
    const sumProfit = fin.standings.reduce((acc, s) => acc + s.profit, 0);

    // Бухгалтерское тождество: результат игроков равен результату дома
    // с обратным знаком. Дом собирает входы и ставку, отдаёт предметы стола
    // и платит компенсации — ничего не берётся из воздуха.
    const entriesPaid = fin.standings.length * TIERS.bronze.entry;
    const compensationPaid =
      fin.auction!.perLoserCompensation * (fin.standings.length - (fin.auction!.winnerId ? 1 : 0));
    const houseNet =
      entriesPaid + fin.auction!.price - fin.auction!.tableValue - compensationPaid;
    expect(sumProfit, 'профиты игроков = −(результат дома)').toBe(-houseNet);
  });

  it('предметы на старте не считаются доходом', () => {
    // игрок приходит со своим предметом — он не должен попасть в профит
    const g = makeGame(
      [
        { id: 'a', name: 'А', cash: 500_000, inventory: [item('own', 120_000)] },
        { id: 'b', name: 'Б', cash: 500_000, inventory: [] },
      ],
      200_000,
    );
    for (const p of g.debug().players) g.confirmEntry(p.id);
    g.advance();
    for (let i = 0; i < 40; i++) {
      if (g.snapshot().auction?.phase === 'bid' && (g.snapshot().auction?.round ?? 0) >= 5) break;
      g.advance();
    }
    // оба пасуют — стол сгорает, игроки теряют только вход
    g.submitBid('a', 0);
    g.submitBid('b', 0);
    advanceUntilFinished(g);

    const fin = g.snapshot().final!;
    const a = fin.standings.find((s) => s.playerId === 'a')!;
    expect(a.startTotal, 'стартовое состояние включает свой предмет').toBe(620_000);
    expect(a.profit, 'свой предмет не создаёт профит').toBe(-TIERS.bronze.entry);
    expect(a.inventoryGained, 'инвентарь не вырос').toBe(0);
  });
});
