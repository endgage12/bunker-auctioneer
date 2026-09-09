import { describe, expect, it } from 'vitest';
import { ITEM_CATALOG, SETS } from '@auctioneer/shared';

describe('сеты убежища', () => {
  it('в каждом сете ровно 5 предметов, и все они есть в каталоге', () => {
    expect(SETS.length).toBe(9);
    for (const set of SETS) {
      expect(set.itemIds).toHaveLength(5);
      for (const defId of set.itemIds) {
        expect(ITEM_CATALOG.some((d) => d.id === defId), defId + ' есть в каталоге').toBe(true);
      }
    }
  });

  it('предметы не повторяются между сетами', () => {
    const all: string[] = [];
    for (const set of SETS) all.push(...set.itemIds);
    expect(new Set(all).size).toBe(all.length);
  });

  it('id сетов уникальны, у каждого есть бонус', () => {
    const ids = SETS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const set of SETS) expect(set.bonusIds.length).toBeGreaterThan(0);
  });
});
