import { describe, expect, it } from 'vitest';
import {
  generateItem,
  generateStarterPack,
  ITEM_CATALOG,
  itemsTotal,
  mulberry32,
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

  it('у каждого предмета каталога фиксированные номинал и размер', () => {
    for (const def of ITEM_CATALOG) {
      expect(Number.isInteger(def.value)).toBe(true);
      expect(def.value).toBeGreaterThan(0);
      expect(def.w).toBeGreaterThanOrEqual(1);
      expect(def.w).toBeLessThanOrEqual(5);
      expect(def.h).toBeGreaterThanOrEqual(1);
      expect(def.h).toBeLessThanOrEqual(5);
    }
  });

  it('фиксированные номиналы и размеры из задания', () => {
    const byName = new Map(ITEM_CATALOG.map((d) => [d.name, d] as const));
    expect(byName.get('Пыльная ваза')).toMatchObject({ value: 2_000, w: 1, h: 2 });
    expect(byName.get('Латунная пуговица')).toMatchObject({ value: 4_000, w: 2, h: 2 });
    expect(byName.get('Ядро вечности')).toMatchObject({ value: 2_234_350, w: 1, h: 1 });
    expect(byName.get('Кубок вечного пира')).toMatchObject({ value: 570_000, w: 1, h: 2 });
  });

  it('сгенерированный предмет повторяет номинал и размер каталога', () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 500; i++) {
      const it = generateItem(rng);
      const def = ITEM_CATALOG.find((d) => d.id === it.defId);
      expect(def).toBeDefined();
      expect(it.value).toBe(def!.value);
      expect(it.w).toBe(def!.w);
      expect(it.h).toBe(def!.h);
      expect(it.name).toBe(def!.name);
      expect(it.rarity).toBe(def!.rarity);
    }
  });
});
