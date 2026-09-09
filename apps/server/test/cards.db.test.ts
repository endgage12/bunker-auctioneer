// Тесты БД-уровня для магазина и особых карточек: крутка колеса фортуны
// за «Пыльную вазу», коллекция карточек и усилители.
// Используется отдельная тестовая БД (data/test-cards.db).
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const TEST_DB = resolve(process.cwd(), '..', '..', 'data', 'test-cards.db');

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

/** Продать все свободные вазы игрока (чтобы тесты крутки были предсказуемыми) */
function clearVases(userId: string): void {
  for (const it of db.getProfile(userId)!.inventory) {
    if (it.defId === 'white-0') db.sellToVendor(userId, it.id);
  }
}

describe('магазин: колесо фортуны', () => {
  it('без вазы крутка не выполняется и карточка не выдаётся', () => {
    const user = db.findOrCreateDevUser('shop-novase@test.dev', 'ШопБезВазы');
    clearVases(user.id);
    const res = db.spinWheel(user.id, () => 0.5);
    expect(res.ok).toBe(false);
    expect(res.error).toContain('Пыльная ваза');
    expect(db.getCards(user.id)).toHaveLength(0);
  });

  it('крутка списывает вазу и выдаёт карточку (детерминированный ГПСЧ)', () => {
    const user = db.findOrCreateDevUser('shop-spin@test.dev', 'ШопКрут');
    clearVases(user.id);
    expect(db.adminGrantItem('shop-spin@test.dev', 'white-0').ok).toBe(true);
    const vasesBefore = db.getShopState(user.id).vaseCount;
    expect(vasesBefore).toBeGreaterThanOrEqual(1);
    // rng = 0.01 -> первый по весам сектор: малый анализатор
    const res = db.spinWheel(user.id, () => 0.01);
    expect(res.ok).toBe(true);
    expect(res.cardId).toBe('analyzer-small');
    const cards = db.getCards(user.id);
    expect(cards.find((c) => c.cardId === 'analyzer-small')?.count).toBe(1);
    expect(db.getShopState(user.id).vaseCount).toBe(vasesBefore - 1);
    // в инвентаре ваза исчезла
    expect(db.getProfile(user.id)!.inventory.some((i) => i.defId === 'white-0')).toBe(false);
  });

  it('сильная карточка выпадает по своему весу (rng -> красный усилитель)', () => {
    const user = db.findOrCreateDevUser('shop-red@test.dev', 'ШопРед');
    clearVases(user.id);
    db.adminGrantItem('shop-red@test.dev', 'white-0');
    const res = db.spinWheel(user.id, () => 0.999);
    expect(res.ok).toBe(true);
    expect(res.cardId).toBe('amp-red');
  });
});

describe('усилители', () => {
  it('превращает случайный предмет слабее цели и тратит карточку', () => {
    const user = db.findOrCreateDevUser('amp@test.dev', 'Амп');
    // продаём весь стартовый инвентарь — останется только подопытная белая ваза
    for (const it of db.getProfile(user.id)!.inventory.slice()) {
      db.sellToVendor(user.id, it.id);
    }
    db.adminGrantItem('amp@test.dev', 'white-0');
    expect(db.spinWheel(user.id, () => 0.999).ok).toBe(true); // amp-red
    // единственный белый предмет-жертва
    expect(db.adminGrantItem('amp@test.dev', 'white-1').ok).toBe(true);
    const before = db.getProfile(user.id)!;
    const victim = before.inventory.find((i) => i.defId === 'white-1')!;
    const res = db.amplifyItem(user.id, 'amp-red');
    expect(res.ok).toBe(true);
    expect(res.removed?.name).toBe(victim.name);
    expect(res.item?.rarity).toBe('red');
    // карточка потрачена
    expect(db.getCards(user.id).find((c) => c.cardId === 'amp-red')).toBeUndefined();
    const after = db.getProfile(user.id)!;
    expect(after.inventory.some((i) => i.id === res.item?.id)).toBe(true);
    expect(after.inventory.some((i) => i.id === victim.id)).toBe(false);
    expect(after.inventory.length).toBe(before.inventory.length);
  });

  it('без предметов слабее цели карточка не тратится', () => {
    const user = db.findOrCreateDevUser('amp-nothing@test.dev', 'АмпПусто');
    // продаём всё, оставляем только синий предмет
    for (const it of db.getProfile(user.id)!.inventory.slice()) {
      db.sellToVendor(user.id, it.id);
    }
    expect(db.adminGrantItem('amp-nothing@test.dev', 'blue-0').ok).toBe(true);
    // синий усилитель (rng = 0.6)
    expect(db.adminGrantItem('amp-nothing@test.dev', 'white-0').ok).toBe(true);
    expect(db.spinWheel(user.id, () => 0.6).ok).toBe(true);
    expect(db.getCards(user.id).find((c) => c.cardId === 'amp-blue')?.count).toBe(1);
    const res = db.amplifyItem(user.id, 'amp-blue');
    expect(res.ok).toBe(false);
    expect(res.error).toContain('слабее');
    // карточка осталась у игрока
    expect(db.getCards(user.id).find((c) => c.cardId === 'amp-blue')?.count).toBe(1);
  });
});
