// Тесты особых карточек: каталог и веса колеса фортуны (shared) +
// карточки-анализаторы в движке партии (личные, только для владельца).
import { describe, expect, it } from 'vitest';
import {
  CARD_DEFS,
  CARD_SETS,
  cardChance,
  findCard,
  mulberry32,
  pickCardByWeight,
} from '@auctioneer/shared';
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
  g.advance(); // лок ставок -> аукцион со скрытым столом
  return g;
}

describe('каталог особых карточек', () => {
  it('id уникальны, каждый комплект содержит карточки, веса в сумме дают 100', () => {
    const ids = CARD_DEFS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const set of CARD_SETS) {
      expect(CARD_DEFS.filter((c) => c.setId === set.id).length).toBeGreaterThan(0);
    }
    const total = CARD_DEFS.reduce((s, c) => s + c.weight, 0);
    expect(total).toBe(100);
    expect(CARD_DEFS.reduce((s, c) => s + cardChance(c), 0)).toBeCloseTo(100, 10);
  });

  it('анализаторы раскрывают предметы, усилители имеют целевую редкость', () => {
    for (const c of CARD_DEFS) {
      if (c.setId === 'analyzers') {
        expect(c.reveals).toBeGreaterThan(0);
        expect(c.rarity).toBeUndefined();
      } else {
        expect(c.rarity).toBeDefined();
        expect(c.reveals).toBeUndefined();
      }
    }
    expect(findCard('analyzer-small')?.reveals).toBe(2);
    expect(findCard('analyzer-perfect')?.reveals).toBe(8);
  });

  it('чем сильнее карточка, тем меньше её вес', () => {
    for (const set of CARD_SETS) {
      const cards = CARD_DEFS.filter((c) => c.setId === set.id).sort((a, b) => a.power - b.power);
      for (let i = 1; i < cards.length; i++) {
        expect(cards[i].weight).toBeLessThan(cards[i - 1].weight);
      }
    }
  });

  it('выбор карточки по весам: сильная карточка выпадает реже', () => {
    const rng = mulberry32(42);
    const counts = new Map<string, number>();
    const N = 20_000;
    for (let i = 0; i < N; i++) {
      const c = pickCardByWeight(rng);
      counts.set(c.id, (counts.get(c.id) ?? 0) + 1);
    }
    const share = (id: string): number => (counts.get(id) ?? 0) / N;
    // малый анализатор (30%) намного чаще красного усилителя (2%)
    expect(share('analyzer-small')).toBeGreaterThan(0.25);
    expect(share('analyzer-small')).toBeLessThan(0.35);
    expect(share('amp-red')).toBeGreaterThan(0.005);
    expect(share('amp-red')).toBeLessThan(0.04);
    expect(share('analyzer-small')).toBeGreaterThan(share('amp-red') * 5);
  });
});

describe('анализаторы в движке партии', () => {
  it('раскрывает редкость случайных скрытых предметов только владельцу', () => {
    const g = makeGame(
      [seed('a', 200_000, []), seed('b', 200_000, [])],
      { rng: mulberry32(7) },
    );
    const err = g.useAnalyzerCard('a', 2);
    expect(err).toBeNull();
    const privA = g.personalSnapshot('a');
    const privB = g.personalSnapshot('b');
    expect(privA?.rarityHints.length).toBe(2);
    expect(privB).toBeNull();
    // подсказки ссылаются на закрытые клетки стола (у закрытых клеток есть itemId)
    const snap = g.snapshot();
    for (const h of privA!.rarityHints) {
      const cells = snap.board.cells.filter((c) => c.kind === 'closed' && c.itemId === h.itemId);
      expect(cells.length).toBeGreaterThan(0);
      // предмет остаётся скрытым в публичном снимке
      expect(snap.items.find((i) => i.id === h.itemId)?.revealed).toBe(false);
    }
  });

  it('подсказки накапливаются и не уходят другим игрокам', () => {
    const g = makeGame(
      [seed('a', 200_000, []), seed('b', 200_000, [])],
      { rng: mulberry32(11) },
    );
    expect(g.useAnalyzerCard('a', 2)).toBeNull();
    expect(g.useAnalyzerCard('a', 4)).toBeNull();
    expect(g.personalSnapshot('a')?.rarityHints.length).toBe(6);
    expect(g.personalSnapshot('b')).toBeNull();
  });

  it('вне аукциона карточку применить нельзя', () => {
    const g = new Game({ id: 'g2', code: 'TEST2', hostId: 'a', players: [seed('a', 200_000, [])], now: () => 0 });
    expect(g.useAnalyzerCard('a', 2)).not.toBeNull();
    expect(g.personalSnapshot('a')).toBeNull();
  });
});
