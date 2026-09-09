import { describe, expect, it } from 'vitest';
import { MARKET_FEE_PCT, marketFee } from '@auctioneer/shared';

describe('барахолка: комиссия', () => {
  it('считается с округлением вниз', () => {
    expect(marketFee(100)).toBe(5);
    expect(marketFee(101)).toBe(5);
    expect(marketFee(199)).toBe(9);
    expect(marketFee(1000)).toBe(50);
    expect(marketFee(1)).toBe(0);
    expect(marketFee(0)).toBe(0);
  });

  it('комиссия неотрицательна и меньше цены', () => {
    for (let p = 1; p <= 20000; p += 37) {
      const fee = marketFee(p);
      expect(fee).toBeGreaterThanOrEqual(0);
      expect(fee).toBeLessThan(p);
    }
  });

  it('константа комиссии равна 5%', () => {
    expect(MARKET_FEE_PCT).toBe(5);
  });
});
