import { describe, expect, it } from 'vitest';
import { BID_SECONDS, mulberry32 } from '@auctioneer/shared';
import { Game } from '../src/game/engine';
import type { EnginePlayerSeed, GameOptions } from '../src/game/engine';
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
  const g = new Game({ id: 'g1', code: 'TEST', hostId: players[0].id, players, now: () => 0, ...opts });
  for (const p of players) g.submitAnte(p.id, 100_000);
  g.advance(); // лок ставок -> призовой лот (банк 200k -> лоты по несколько предметов)
  return g;
}

describe('бонусы сетов в движке', () => {
  it('личное раскрытие получает только владелец бонуса', () => {
    const g = makeGame(
      [seed('a', 200_000, []), seed('b', 200_000, [])],
      { playerBonuses: { a: ['reveal_plus_one'] }, rng: mulberry32(7) },
    );
    const privA = g.personalSnapshot('a');
    const privB = g.personalSnapshot('b');
    expect(privA?.reveals.length).toBe(1);
    expect(privB).toBeNull();
  });

  it('слух дракона сообщает редкость самого дорогого скрытого предмета', () => {
    const g = makeGame(
      [seed('a', 200_000, []), seed('b', 200_000, [])],
      { playerBonuses: { a: ['dragon_hint'] }, rng: mulberry32(5) },
    );
    const priv = g.personalSnapshot('a');
    expect(priv?.hints.length).toBe(1);
    expect(priv?.hints[0]).toContain('редкости');
  });

  it('рыцарь: +10 секунд к таймеру ставок', () => {
    const g = makeGame(
      [seed('a', 200_000, []), seed('b', 200_000, [])],
      { playerBonuses: { a: ['bid_time_bonus'] } },
    );
    g.advance(); // -> фаза ставок
    expect(g.deadline).toBe((BID_SECONDS + 10) * 1000);
  });
});
