import { describe, expect, it } from 'vitest';
import {
  generateSantaReward,
  mulberry32,
  RARITY_ORDER,
  RARITY_VALUE_RANGE,
  SANTA_MAX_REWARDS,
  SANTA_MID_MAX,
  SANTA_MID_MIN,
  SANTA_MIN_ITEMS,
  santaRewardCount,
  santaRewardRarityWeights,
  santaTimerMs,
} from '@auctioneer/shared';

describe('Тайный Санта: минимальный вклад', () => {
  it('круг запускается только после 3 вложений (анти-абуз)', () => {
    expect(SANTA_MIN_ITEMS).toBe(3);
  });
});

describe('Тайный Санта: таймер дропа', () => {
  it('менее 100 000 — 15 секунд', () => {
    expect(santaTimerMs(0)).toBe(15_000);
    expect(santaTimerMs(1)).toBe(15_000);
    expect(santaTimerMs(SANTA_MID_MIN - 1)).toBe(15_000);
  });

  it('от 100 000 до 250 000 включительно — 30 секунд', () => {
    expect(santaTimerMs(SANTA_MID_MIN)).toBe(30_000);
    expect(santaTimerMs(150_000)).toBe(30_000);
    expect(santaTimerMs(SANTA_MID_MAX)).toBe(30_000);
  });

  it('свыше 250 000 — 60 секунд', () => {
    expect(santaTimerMs(SANTA_MID_MAX + 1)).toBe(60_000);
    expect(santaTimerMs(1_000_000)).toBe(60_000);
  });
});

describe('Тайный Санта: шансы редкостей', () => {
  it('веса неотрицательны и в сумме дают 100', () => {
    for (const v of [0, 10_000, 99_999, 100_000, 200_000, 250_000, 400_000, 1_000_000]) {
      const w = santaRewardRarityWeights(v);
      const total = RARITY_ORDER.reduce((s, r) => s + w[r], 0);
      expect(total).toBeCloseTo(100, 5);
      for (const r of RARITY_ORDER) expect(w[r]).toBeGreaterThanOrEqual(0);
    }
  });

  it('чем выше стоимость вложений, тем выше шанс редкого дропа', () => {
    const rareOf = (v: number): number => {
      const w = santaRewardRarityWeights(v);
      const total = RARITY_ORDER.reduce((s, r) => s + w[r], 0);
      return (w.purple + w.gold + w.red) / total;
    };
    // в пределах шкалы 0..250 000 шанс редкого дропа строго растёт,
    // после 250 000 (верхняя ступень) — выходит на плато максимума
    const samples = [10_000, 50_000, 100_000, 150_000, 200_000, 250_000];
    for (let i = 1; i < samples.length; i++) {
      expect(rareOf(samples[i])).toBeGreaterThan(rareOf(samples[i - 1]));
    }
    expect(rareOf(400_000)).toBeCloseTo(rareOf(250_000), 10);
    expect(rareOf(1_000_000)).toBeCloseTo(rareOf(250_000), 10);
    // на нулевом круге красные не выпадают вовсе, на дорогом — выпадают
    expect(santaRewardRarityWeights(0).red).toBe(0);
    expect(santaRewardRarityWeights(1_000_000).red).toBeGreaterThan(4);
  });

  it('масса весов уходит от белого/зелёного к редким редкостям', () => {
    const rareRarities = ['blue', 'purple', 'gold', 'red'] as const;
    for (const r of rareRarities) {
      let prev = -1;
      for (const v of [0, 100_000, 250_000]) {
        const w = santaRewardRarityWeights(v)[r];
        expect(w).toBeGreaterThan(prev);
        prev = w;
      }
      // выше 250 000 шансы выходят на плато максимума
      expect(santaRewardRarityWeights(1_000_000)[r]).toBeCloseTo(santaRewardRarityWeights(250_000)[r], 10);
    }
    // белые, наоборот, редеют
    let prevWhite = Number.POSITIVE_INFINITY;
    for (const v of [0, 100_000, 250_000]) {
      const w = santaRewardRarityWeights(v).white;
      expect(w).toBeLessThan(prevWhite);
      prevWhite = w;
    }
  });
});

describe('Тайный Санта: количество и генерация дропа', () => {
  it('количество предметов растёт с суммой и не превышает максимум', () => {
    const noBonus = (): number => 0.99; // > 0.25 — без бонусного предмета
    const bonus = (): number => 0.1; // < 0.25 — бонусный предмет
    expect(santaRewardCount(noBonus, 50_000)).toBe(2);
    expect(santaRewardCount(noBonus, 150_000)).toBe(3);
    expect(santaRewardCount(noBonus, 250_000)).toBe(4);
    expect(santaRewardCount(bonus, 50_000)).toBe(3);
    expect(santaRewardCount(noBonus, 5_000_000)).toBe(SANTA_MAX_REWARDS);
    expect(santaRewardCount(bonus, 5_000_000)).toBe(SANTA_MAX_REWARDS);
  });

  it('предметы дропа корректны (редкость, стоимость, размеры, id каталога)', () => {
    const rng = mulberry32(42);
    for (const v of [10_000, 150_000, 500_000]) {
      for (let i = 0; i < 100; i++) {
        const it = generateSantaReward(rng, v);
        const [min, max] = RARITY_VALUE_RANGE[it.rarity];
        expect(it.value).toBeGreaterThanOrEqual(min);
        expect(it.value).toBeLessThanOrEqual(max);
        expect(it.w).toBeGreaterThanOrEqual(1);
        expect(it.w).toBeLessThanOrEqual(5);
        expect(it.h).toBeGreaterThanOrEqual(1);
        expect(it.h).toBeLessThanOrEqual(5);
        expect(it.defId).toMatch(/^(white|green|blue|purple|gold|red)-\d+$/);
      }
    }
  });

  it('дорогой круг приносит редкие предметы заметно чаще', () => {
    const rareShare = (v: number): number => {
      const rng = mulberry32(1234);
      let rare = 0;
      const n = 2000;
      for (let i = 0; i < n; i++) {
        const it = generateSantaReward(rng, v);
        if (it.rarity === 'purple' || it.rarity === 'gold' || it.rarity === 'red') rare++;
      }
      return rare / n;
    };
    expect(rareShare(500_000)).toBeGreaterThan(rareShare(50_000) * 3);
  });
});
