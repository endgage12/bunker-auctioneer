// Тесты БД-уровня для продажи торговцу: «продать всё» по номиналу.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

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
  it('«продать всё» продаёт весь инвентарь по номиналу и начисляет деньги', () => {
    const user = db.findOrCreateDevUser('vendor-all@test.dev', 'Вендор');
    const before = db.getProfile(user.id)!;
    expect(before.inventory.length).toBeGreaterThan(0);
    const sum = before.inventory.reduce((s, i) => s + i.value, 0);
    const cashBefore = before.cash;

    const res = db.sellAllToVendor(user.id);
    expect(res.ok).toBe(true);
    expect(res.count).toBe(before.inventory.length);
    expect(res.value).toBe(sum);

    const after = db.getProfile(user.id)!;
    expect(after.inventory).toHaveLength(0);
    expect(after.cash).toBe(cashBefore + sum);
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
