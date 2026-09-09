// Тесты БД-уровня для «Тайного Санты»: жертвоприношения, минимальный вклад,
// таймер круга, дроп и очередь дропа при переполненном ящике.
// Используется отдельная тестовая БД (data/test-santa.db) и виртуальное время.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

// cwd vitest — apps/server; БД кладём в data/ корня репозитория
const TEST_DB = resolve(process.cwd(), '..', '..', 'data', 'test-santa.db');

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

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(() => {
  vi.useRealTimers();
});

function advance(ms: number): void {
  vi.setSystemTime(new Date(Date.now() + ms));
}

describe('Тайный Санта: хранилище', () => {
  it('круг запускается только после 3 вложений (анти-абуз)', () => {
    const user = db.findOrCreateDevUser('santa-min@test.dev', 'СантаМин');
    let profile = db.getProfile(user.id)!;
    // гарантируем минимум 3 предмета в инвентаре
    while (profile.inventory.length < 3) {
      expect(db.adminGrantItem('santa-min@test.dev', 'green-0').ok).toBe(true);
      profile = db.getProfile(user.id)!;
    }
    const items = profile.inventory.slice(0, 3);

    // начальное состояние пустое
    let st = db.getSanta(user.id);
    expect(st.box).toHaveLength(0);
    expect(st.poolValue).toBe(0);
    expect(st.deadline).toBeNull();
    expect(st.lastCycle).toBeNull();

    // первое вложение: круг ещё не запущен
    expect(db.sacrificeToSanta(user.id, items[0].id).ok).toBe(true);
    st = db.getSanta(user.id);
    expect(st.box).toHaveLength(1);
    expect(st.box[0].kind).toBe('sacrifice');
    expect(st.poolValue).toBe(items[0].value);
    expect(st.deadline).toBeNull();
    // предмет исчез из инвентаря (безвозвратно)
    expect(db.getProfile(user.id)!.inventory.find((i) => i.id === items[0].id)).toBeUndefined();
    // вложение забрать нельзя
    expect(db.takeFromSanta(user.id, items[0].id).ok).toBe(false);
    // в занятую клетку ящика вложить нельзя
    expect(db.sacrificeToSanta(user.id, items[1].id, 0, 0).ok).toBe(false);

    // второе вложение: таймер всё ещё не идёт
    expect(db.sacrificeToSanta(user.id, items[1].id).ok).toBe(true);
    st = db.getSanta(user.id);
    expect(st.box.filter((b) => b.kind === 'sacrifice')).toHaveLength(2);
    expect(st.poolValue).toBe(items[0].value + items[1].value);
    expect(st.deadline).toBeNull();

    // время идёт, но круг не завершается и не даёт дропа (анти-абуз)
    advance(16_000);
    st = db.getSanta(user.id);
    expect(st.box.filter((b) => b.kind === 'sacrifice')).toHaveLength(2);
    expect(st.poolValue).toBe(items[0].value + items[1].value);

    // третье вложение запускает таймер по сумме вложений
    expect(db.sacrificeToSanta(user.id, items[2].id).ok).toBe(true);
    st = db.getSanta(user.id);
    const total = items[0].value + items[1].value + items[2].value;
    const tierMs = total < 100_000 ? 15_000 : total <= 250_000 ? 30_000 : 60_000;
    expect(st.poolValue).toBe(total);
    expect(st.deadline).toBe(Date.now() + tierMs);

    // таймер истекает -> вложения исчезают, появляется дроп
    advance(tierMs + 1_000);
    st = db.getSanta(user.id);
    expect(st.poolValue).toBe(0);
    expect(st.deadline).toBeNull();
    expect(st.box.length).toBeGreaterThan(0);
    expect(st.box.every((b) => b.kind === 'reward')).toBe(true);

    // итог круга для модального окна: 3 вложения, весь дроп учтён
    const lc = st.lastCycle;
    expect(lc).not.toBeNull();
    expect(lc!.itemsIn).toBe(3);
    expect(lc!.valueIn).toBe(total);
    const allRewards = [...st.box, ...st.pending];
    expect(lc!.itemsOut).toBe(allRewards.length);
    expect(lc!.valueOut).toBe(allRewards.reduce((s, b) => s + b.value, 0));

    // забираем первый дроп в инвентарь (клетку сервер подбирает сам)
    const rw = st.box[0];
    expect(db.takeFromSanta(user.id, rw.id).ok).toBe(true);
    const got = db.getProfile(user.id)!.inventory.find((i) => i.id === rw.id);
    expect(got).toBeDefined();
    expect(typeof got!.invX).toBe('number');
    expect(typeof got!.invY).toBe('number');
    expect(db.getSanta(user.id).box.find((b) => b.id === rw.id)).toBeUndefined();
  });

  it('дроп, которому не хватило клеток, ждёт свободного места', () => {
    // Math.random = 0.01 -> гранты: красные 1x1 (легко помещаются в ящик)
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0.01);
    const user = db.findOrCreateDevUser('santa-overflow@test.dev', 'Санта2');
    const granted: string[] = [];
    for (let i = 0; i < 3; i++) {
      const g = db.adminGrantItem('santa-overflow@test.dev', 'red-' + i);
      expect(g.ok).toBe(true);
      granted.push(g.item!.id);
    }
    // три вложения по ~161 400 -> сумма свыше 250 000 -> круг 60 секунд
    for (const id of granted) {
      expect(db.sacrificeToSanta(user.id, id).ok).toBe(true);
    }

    // Math.random = 0.99 -> весь дроп: красные 5x5 (25 клеток),
    // в ящике 9x9 помещается только один такой предмет — очередь детерминирована
    spy.mockReturnValue(0.99);
    advance(61_000);
    let st = db.getSanta(user.id);

    // 2 + floor(484200/100000) = 6 предметов дропа: один в ячейках, пять в очереди
    expect(st.box.filter((b) => b.kind === 'reward')).toHaveLength(1);
    expect(st.pending).toHaveLength(5);
    expect(st.box[0].w).toBe(5);
    expect(st.box[0].h).toBe(5);

    // итог круга для модального окна: 3 вложенных красных -> 6 красных
    const lc = st.lastCycle;
    expect(lc).not.toBeNull();
    expect(lc!.itemsIn).toBe(3);
    expect(lc!.valueIn).toBe(161_400 * 3);
    expect(lc!.itemsOut).toBe(6);
    expect(lc!.valueOut).toBe(298_600 * 6);

    // забираем размещённый дроп -> на его место встаёт следующий из очереди
    const takenId = st.box[0].id;
    expect(db.takeFromSanta(user.id, takenId).ok).toBe(true);
    st = db.getSanta(user.id);
    expect(st.box.filter((b) => b.kind === 'reward')).toHaveLength(1);
    expect(st.pending).toHaveLength(4);

    // ничего не потерялось: 6 предметов дропа = 1 взятый + 1 в ячейках + 4 в очереди
    expect(st.box.length + st.pending.length).toBe(5);
    expect(db.getProfile(user.id)!.inventory.some((i) => i.id === takenId)).toBe(true);
  });
});
