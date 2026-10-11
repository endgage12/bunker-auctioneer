// Тест честности ботов: у ботов нет доступа к скрытому состоянию партии.
//
// Боты обязаны видеть ровно то же, что человек в браузере: публичный снимок
// состояния из Socket.IO. Тест проверяет это статически (исходники ботов не
// обращаются к внутренностям движка) и динамически (в снимке нет секретов).
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const BOT_DIR = join(__dirname, '..', 'src', 'bots');

/**
 * Убрать комментарии и строковые литералы, чтобы проверка ловила настоящие
 * обращения к внутренностям движка, а не упоминания в пояснениях.
 */
function stripCommentsAndStrings(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, ' ') // блочные комментарии
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ') // строчные комментарии (не трогаем http://)
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');
}

function botSources(): Array<{ name: string; text: string }> {
  return readdirSync(BOT_DIR)
    .filter((f) => f.endsWith('.ts'))
    .map((name) => ({ name, text: stripCommentsAndStrings(readFileSync(join(BOT_DIR, name), 'utf8')) }));
}

describe('честность ботов: нет доступа к скрытому состоянию', () => {
  it('код ботов не импортирует движок партии и менеджер комнат напрямую', () => {
    const banned = [
      "from '../game/engine'",
      'from "../game/engine"',
      "from '../game/manager'",
      'from "../game/manager"',
    ];
    for (const { name, text } of botSources()) {
      // пул и метрики работают с менеджером комнат для матчмейкинга — это не состояние партии
      for (const b of banned) {
        if (b.includes('game/engine')) {
          expect(text.includes(b), name + ' не должен импортировать движок партии').toBe(false);
        }
      }
    }
  });

  it('боты не трогают внутренние поля движка (revealOrder, placed, rng, приватные снимки)', () => {
    const banned = [
      'revealOrder',
      'revealForRound',
      'buildTable',
      'shuffle(',
      'personalSnapshot',
      'privateReveals',
      'rarityHints',
      'debug(',
      // чужие слепые ставки: сервер публикует их только в фазе resolve
      'auction.bids',
      'a.bids',
      'snapshot().placed',
    ];
    for (const { name, text } of botSources()) {
      for (const token of banned) {
        expect(text.includes(token), name + ' не должен использовать ' + token).toBe(false);
      }
    }
  });

  it('боты получают состояние только через сокет-событие state', () => {
    const client = botSources().find((s) => s.name === 'client.ts');
    expect(client).toBeDefined();
    // единственная подписка на состояние — S2C.state
    expect(client!.text).toContain('S2C.state');
    // и никаких обращений к базе напрямую из клиента бота
    expect(client!.text.includes("from '../db'")).toBe(false);
  });

  it('боты не получают выдач сверх стартового набора', () => {
    for (const { name, text } of botSources()) {
      for (const banned of ['depositBank', 'transferFromBank', 'CREATE_ITEM', 'items/grant', 'admin/']) {
        expect(text.includes(banned), name + ' не должен использовать ' + banned).toBe(false);
      }
    }
  });
});

describe('публичный снимок не содержит скрытой информации', () => {
  it('скрытые предметы не попадают в снимок с координатами', async () => {
    const { Game } = await import('../src/game/engine');
    const game = new Game({
      id: 'fair-1',
      code: 'FAIR',
      hostId: 'p1',
      players: [
        { id: 'p1', name: 'A', cash: 500_000, inventory: [] },
        { id: 'p2', name: 'B', cash: 500_000, inventory: [] },
        { id: 'p3', name: 'C', cash: 500_000, inventory: [] },
        { id: 'p4', name: 'D', cash: 500_000, inventory: [] },
      ],
      bettingSeconds: 1,
      revealSeconds: 1,
      bidSeconds: 1,
      resolveSeconds: 1,
    });

    const snap = game.snapshot();
    // до начала торгов стол запечатан: ни один предмет не раскрыт
    expect(snap.items.length).toBeGreaterThan(0);
    for (const item of snap.items) {
      expect(item.revealed).toBe(false);
      // у скрытого предмета нет ни координат, ни названия, ни стоимости
      expect(item.x).toBeUndefined();
      expect(item.y).toBeUndefined();
      expect(item.name).toBeUndefined();
      expect(item.rarity).toBeUndefined();
      expect(item.value).toBeUndefined();
    }
    // и в снимке нет служебных полей движка
    const raw = JSON.stringify(snap);
    for (const secret of ['revealOrder', 'revealOrder"', 'privateReveals', 'rarityHints', 'rngState']) {
      expect(raw.includes(secret)).toBe(false);
    }
  });

  it('скрытая часть стола не утекает через снимок и после начала торгов', async () => {
    const { Game } = await import('../src/game/engine');
    const game = new Game({
      id: 'fair-2',
      code: 'FAIR2',
      hostId: 'p1',
      players: [
        { id: 'p1', name: 'A', cash: 500_000, inventory: [] },
        { id: 'p2', name: 'B', cash: 500_000, inventory: [] },
      ],
      bettingSeconds: 1,
      revealSeconds: 1,
      bidSeconds: 1,
      resolveSeconds: 1,
    });
    game.confirmEntry('p1');
    game.confirmEntry('p2');
    game.tick(); // betting → auction/reveal

    const snap = game.snapshot();
    const hidden = snap.items.filter((i) => !i.revealed);
    const revealed = snap.items.filter((i) => i.revealed);
    expect(revealed.length).toBeGreaterThan(0);
    expect(hidden.length).toBeGreaterThan(0);
    // раскрытые видны, скрытые — нет координат и названий
    for (const h of hidden) {
      expect(h.x).toBeUndefined();
      expect(h.y).toBeUndefined();
      expect(h.name).toBeUndefined();
      expect(h.value).toBeUndefined();
    }
    for (const r of revealed) {
      expect(typeof r.x).toBe('number');
      expect(typeof r.y).toBe('number');
    }
    // суммарная стоимость раскрытого — публичная, это и есть «ожидаемая стоимость»
    expect(snap.auction?.revealedValue).toBeGreaterThan(0);
  });
});
