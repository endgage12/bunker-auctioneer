// Тесты БД-уровня для продажи торговцу: «продать всё» по ставке торговца
// (VENDOR_RATE от номинала — плата за мгновенность, барахолка даёт больше).
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import {VENDOR_RATE} from '@auctioneer/shared';

const TEST_DB = resolve(process.cwd(), '..', '..', 'data', 'test-vendor.db');

let db: typeof import('../src/db');

beforeAll(async () => {
  for (const f of [TEST_DB, TEST_DB + '-wal', TEST_DB + '-shm']) {
    if (existsSync(f)) rmSync(f, { force: true });
  }
  process.env.DB_PATH = TEST_DB;
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));
  db = await import('../src/db');
});

afterAll(() => {
  vi.useRealTimers();
});

describe('продажа торговцу', () => {
  it('«продать всё» продаёт инвентарь по ставке торговца и начисляет деньги', () => {
    const user = db.findOrCreateDevUser('vendor-all@test.dev', 'Вендор');
    const before = db.getProfile(user.id)!;
    expect(before.inventory.length).toBeGreaterThan(0);
    const sum = before.inventory.reduce((s, i) => s + i.value, 0);
    const cashBefore = before.cash;

    const res = db.sellAllToVendor(user.id);
    expect(res.ok).toBe(true);
    expect(res.count).toBe(before.inventory.length);
    // торговец платит долю номинала, а не весь номинал
    const expected = Math.round(sum * VENDOR_RATE);
    const paid = res.value ?? 0;
    expect(paid).toBeGreaterThan(0);
    expect(paid).toBeLessThan(sum);
    expect(Math.abs(paid - expected)).toBeLessThanOrEqual(before.inventory.length);

    const after = db.getProfile(user.id)!;
    expect(after.inventory).toHaveLength(0);
    expect(after.cash).toBe(cashBefore + (res.value ?? 0));
  });

  it('мгновенная продажа торговцу невыгоднее номинала, но и не бесплатна', () => {
    const user = db.findOrCreateDevUser('vendor-rate@test.dev', 'Ставка');
    const before = db.getProfile(user.id)!;
    const item = before.inventory[0];
    const res = db.sellToVendor(user.id, item.id);
    expect(res.ok).toBe(true);
    // ставка торговца: плата за удобство, но не грабёж
    expect(res.value!).toBeLessThan(item.value);
    expect(res.value!).toBeGreaterThan(Math.round(item.value * 0.5));
  });

  it('повторная продажа всего — ошибка «нет предметов»', () => {
    const user = db.findOrCreateDevUser('vendor-all@test.dev', 'Вендор');
    const res = db.sellAllToVendor(user.id);
    expect(res.ok).toBe(false);
    expect(res.error).toContain('Нет предметов');
  });

  it('предметы на барахолке не продаются', () => {
    const user = db.findOrCreateDevUser('vendor-guard@test.dev', 'ВендорГард');
    const inv = db.getProfile(user.id)!.inventory;
    const listed = inv[0];
    expect(db.createListing(user.id, listed.id, 12_345).ok).toBe(true);

    const res = db.sellAllToVendor(user.id);
    expect(res.ok).toBe(true);
    expect(res.count).toBe(inv.length - 1);

    // в инвентаре пусто, но предмет с барахолки остался за игроком
    expect(db.getProfile(user.id)!.inventory).toHaveLength(0);
    expect(db.getMarketListings(user.id).some((l) => l.item.id === listed.id)).toBe(true);
  });
});
