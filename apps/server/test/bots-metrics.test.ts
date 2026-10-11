// Тесты метрик матчмейкинга (SLA ожидания лобби) и фильтра ботов в таблице лидеров.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

describe('метрики ожидания лобби', () => {
  it('медиана и p95 считаются, SLA проверяется', async () => {
    const m = await import('../src/bots/metrics');
    m.resetMatchmakingStats();

    // пусто — SLA формально соблюдён (нечего нарушать)
    expect(m.matchmakingStats().samples).toBe(0);
    expect(m.matchmakingStats().withinSla).toBe(true);

    // 99 замеров по 10 секунд и один «плохой» на 40 — p95 должен уложиться в 30 с
    for (let i = 0; i < 99; i++) m.noteLobbyWait(10_000, i % 3 === 0);
    expect(m.matchmakingStats().withinSla).toBe(true);
    expect(m.matchmakingStats().medianMs).toBe(10_000);

    // добавляем много плохих замеров — SLA должен нарушиться
    for (let i = 0; i < 50; i++) m.noteLobbyWait(45_000, true);
    const stats = m.matchmakingStats();
    expect(stats.samples).toBe(149);
    expect(stats.p95Ms).toBeGreaterThan(30_000);
    expect(stats.withinSla).toBe(false);
    // в человеческих замерах медиана тоже видна
    expect(stats.humanSamples).toBeGreaterThan(0);
    expect(m.matchmakingSummary()).toContain('SLA НАРУШЕН');
    m.resetMatchmakingStats();
  });

  it('счётчики запросов человека работают', async () => {
    const m = await import('../src/bots/metrics');
    m.resetMatchmakingStats();
    m.noteHumanMatchRequest();
    m.noteHumanMatchRequest();
    m.noteHumanMatchFilled();
    const s = m.matchmakingStats();
    expect(s.humanMatchRequests).toBe(2);
    expect(s.humanMatchFilled).toBe(1);
    m.resetMatchmakingStats();
  });
});

describe('таблица лидеров: фильтр ботов', () => {
  const TEST_DB = resolve(process.cwd(), '..', '..', 'data', 'test-bots-leaderboard.db');
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
    for (const f of [TEST_DB, TEST_DB + '-wal', TEST_DB + '-shm']) {
      if (existsSync(f)) rmSync(f, { force: true });
    }
  });

  it('боты помечены и по умолчанию видны, а фильтр оставляет только людей', () => {
    const human = db.findOrCreateDevUser('lb-human@test.dev', 'Человек');
    const bot = db.findOrCreateBotUser('bot-x@auctioneer.local', 'Бот Тестовый', 'data:image/svg+xml,<svg/>', 'gambler');

    expect(db.isBotUser(human.id)).toBe(false);
    expect(db.isBotUser(bot.id)).toBe(true);
    expect(bot.isBot).toBe(true);
    expect(bot.botKind).toBe('gambler');

    // у бота ровно стартовый набор, как у человека
    const botProfile = db.getProfile(bot.id);
    const humanProfile = db.getProfile(human.id);
    expect(botProfile?.cash).toBe(humanProfile?.cash);
    expect(botProfile?.isBot).toBe(true);

    const withBots = db.getLeaderboard(1, 50, human.id, true);
    const rowsWithBots = withBots.entries.find((e) => e.id === bot.id);
    expect(rowsWithBots?.isBot).toBe(true);
    expect(withBots.botsTotal).toBe(1);
    expect(withBots.humansTotal).toBe(1);

    const humansOnly = db.getLeaderboard(1, 50, human.id, false);
    expect(humansOnly.entries.some((e) => e.id === bot.id)).toBe(false);
    expect(humansOnly.entries.some((e) => e.id === human.id)).toBe(true);
    // счётчики не зависят от фильтра — они описывают всю таблицу
    expect(humansOnly.botsTotal).toBe(1);
    expect(humansOnly.humansTotal).toBe(1);
  });

  it('повторный вызов не создаёт второго бота с тем же email', () => {
    const before = db.listBotUsers().length;
    db.findOrCreateBotUser('bot-x@auctioneer.local', 'Бот Тестовый', 'data:image/svg+xml,<svg/>', 'gambler');
    expect(db.listBotUsers().length).toBe(before);
  });

  it('характер бота сохраняется между перезапусками (не перезаписывается)', () => {
    const bot = db.findOrCreateBotUser('bot-y@auctioneer.local', 'Бот Второй', 'data:image/svg+xml,<svg/>', 'cautious');
    // при повторном «запуске» с другим характером старый должен сохраниться
    const again = db.findOrCreateBotUser('bot-y@auctioneer.local', 'Бот Второй', 'data:image/svg+xml,<svg/>', 'greedy');
    expect(again.id).toBe(bot.id);
    expect(again.botKind).toBe('cautious');
  });
});
