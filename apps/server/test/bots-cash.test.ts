// Регрессия матчмейкинга: парк ботов не должен «вымирать».
//
// Найденный баг: боты платят вступительные ставки и покупают предметы, поэтому
// НАЛИЧНЫЕ у них падают почти до нуля, хотя инвентарь стоит сотни тысяч. Если
// пул отбирает ботов для игры только по наличным, весь парк постепенно
// исключается из подбора — игры прекращаются, и живой игрок ждёт вечно.
// Спасает продажа предметов торговцу (refillCash).
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const TEST_DB = resolve(process.cwd(), '..', '..', 'data', 'test-bots-cash.db');

let db: typeof import('../src/db');
let Bot: typeof import('../src/bots/bot').Bot;
let BOT_MIN_CASH: number;

beforeAll(async () => {
  for (const f of [TEST_DB, TEST_DB + '-wal', TEST_DB + '-shm']) {
    if (existsSync(f)) rmSync(f, { force: true });
  }
  process.env.DB_PATH = TEST_DB;
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));
  db = await import('../src/db');
  ({ Bot } = await import('../src/bots/bot'));
  ({ BOT_MIN_CASH } = await import('../src/bots/options'));
});

afterAll(() => {
  vi.useRealTimers();
  for (const f of [TEST_DB, TEST_DB + '-wal', TEST_DB + '-shm']) {
    if (existsSync(f)) rmSync(f, { force: true });
  }
});

/** Бот с подставным «сокетом»: нам важна только логика доступности */
function makeBot(name: string, userId: string, cash = 0) {
  let refills = 0;
  const bot = new Bot(
    { id: userId, name, token: 'x' },
    {
      apiOrigin: 'http://127.0.0.1:1',
      character: {
        id: 'calculating',
        name: 'Расчётливый',
        description: '',
        weight: 1,
        risk: 0.5,
        caution: 0,
        greed: 0.5,
        tilt: 0.2,
        reaction: [2, 7],
        blunder: 0.04,
        cardEagerness: 0.8,
        sessionPatience: 0.75,
      },
      rng: () => 0.5,
      analyzerCardIds: () => [],
      posture: () => ({ morale: 0.5, ambition: 1 }),
      onGameFinished: () => undefined,
      metaGame: async () => {
        refills += 1;
      },
    },
  );
  return { bot, refills: () => refills, cash };
}

describe('бот без наличных не выпадает из парка навсегда', () => {
  it('новый бот получает стартовый набор, а не пустой кошелёк', () => {
    const user = db.findOrCreateBotUser('cash-bot@auctioneer.local', 'Кэш Бот', 'data:,', 'calculating');
    const profile = db.getProfile(user.id);
    expect(profile!.cash).toBeGreaterThanOrEqual(BOT_MIN_CASH);
    expect(profile!.inventory.length).toBeGreaterThan(0);
  });

  it('бот без наличных просит пополнение, а не исчезает из подбора', () => {
    const user = db.findOrCreateBotUser('cash-bot2@auctioneer.local', 'Кэш Бот 2', 'data:,', 'calculating');
    const { bot } = makeBot('Кэш Бот 2', user.id);
    // idle-фаза означает «свободен», но наличных на ставку нет
    expect(bot.available).toBe(true);
    expect(bot.wantsToPlay(0)).toBe(false);
    // именно этот сигнал использует пул, чтобы отправить бота к торговцу
    expect(bot.needsCash(0)).toBe(true);
    // с деньгами бот играет
    expect(bot.wantsToPlay(BOT_MIN_CASH * 2)).toBe(true);
    expect(bot.needsCash(BOT_MIN_CASH * 2)).toBe(false);
  });

  it('refillCash вызывает мета-игру ровно один раз за раз (защита от наложения)', async () => {
    const user = db.findOrCreateBotUser('cash-bot3@auctioneer.local', 'Кэш Бот 3', 'data:,', 'calculating');
    const { bot, refills } = makeBot('Кэш Бот 3', user.id);
    await Promise.all([bot.refillCash(), bot.refillCash(), bot.refillCash()]);
    expect(refills()).toBe(1);
    // сразу же повторно нельзя: бот «сходил на рынок», нужен кулдаун
    await bot.refillCash();
    expect(refills()).toBe(1);
    // после кулдауна пополнение снова разрешено
    vi.setSystemTime(new Date(Date.now() + 21_000));
    await bot.refillCash();
    expect(refills()).toBe(2);
  });

  it('бот с деньгами не считается нуждающимся в пополнении', () => {
    const user = db.findOrCreateBotUser('cash-bot4@auctioneer.local', 'Кэш Бот 4', 'data:,', 'calculating');
    const { bot } = makeBot('Кэш Бот 4', user.id);
    expect(bot.needsCash(BOT_MIN_CASH)).toBe(false);
    expect(bot.needsCash(BOT_MIN_CASH * 10)).toBe(false);
  });

  it('остановленный бот не просит пополнения', () => {
    const user = db.findOrCreateBotUser('cash-bot6@auctioneer.local', 'Кэш Бот 6', 'data:,', 'calculating');
    const { bot } = makeBot('Кэш Бот 6', user.id);
    bot.stop();
    expect(bot.needsCash(0)).toBe(false);
    expect(bot.wantsToPlay(0)).toBe(false);
  });

  it('продажа предметов торговцу действительно даёт наличные', () => {
    const user = db.findOrCreateBotUser('cash-bot5@auctioneer.local', 'Кэш Бот 5', 'data:,', 'calculating');
    const before = db.getProfile(user.id)!;
    expect(before.inventory.length).toBeGreaterThan(0);
    const result = db.sellAllToVendor(user.id);
    expect(result.ok).toBe(true);
    const after = db.getProfile(user.id)!;
    expect(after.cash).toBeGreaterThan(before.cash);
    expect(after.inventory.length).toBe(0);
    // выручка сопоставима с номиналом проданного (без эмиссии из воздуха)
    expect(after.cash - before.cash).toBeLessThanOrEqual(
      before.inventory.reduce((sum, i) => sum + i.value, 0) + 1,
    );
  });
});
