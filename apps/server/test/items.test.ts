import { describe, expect, it } from 'vitest';
import {
  generateItem,
  generateStarterPack,
  itemsTotal,
  mulberry32,
  RARITY_VALUE_RANGE,
  STARTER_PACK_MAX,
  STARTER_PACK_MIN,
} from '@auctioneer/shared';

describe('генерация предметов', () => {
  it('стартовый набор всегда стоит ~300k', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const pack = generateStarterPack(mulberry32(seed * 7919 + 13));
      const total = itemsTotal(pack);
      expect(total).toBeGreaterThanOrEqual(STARTER_PACK_MIN);
      expect(total).toBeLessThanOrEqual(STARTER_PACK_MAX);
      expect(pack.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('размеры и стоимость предметов в допустимых диапазонах', () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 500; i++) {
      const it = generateItem(rng);
      expect(it.w).toBeGreaterThanOrEqual(1);
      expect(it.w).toBeLessThanOrEqual(5);
      expect(it.h).toBeGreaterThanOrEqual(1);
      expect(it.h).toBeLessThanOrEqual(5);
      const [min, max] = RARITY_VALUE_RANGE[it.rarity];
      expect(it.value).toBeGreaterThanOrEqual(min);
      expect(it.value).toBeLessThanOrEqual(max);
      expect(it.value % 100).toBe(0);
    }
  });
});
