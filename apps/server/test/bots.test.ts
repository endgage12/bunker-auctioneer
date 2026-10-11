// Тесты мозга бота: характеры должны вести себя по-разному и по-человечески.
import { describe, expect, it } from 'vitest';

import {BOT_CHARACTERS, BOT_CHARACTER_IDS, mulberry32, TIERS} from '@auctioneer/shared';
import type { BotCharacter, PublicGame, PublicPlayer } from '@auctioneer/shared';

/** Фиксированная плата за вход: тесты играют в медном зале */
const ENTRY = TIERS.bronze.entry;
import {
  decideEntry,
  decideBid,
  estimateTableValue,
  reactionDelay,
  roundAmount,
  willingnessToPay,
} from '../src/bots/brain';

/** Минимальный публичный снимок партии — ровно то, что видит человек в браузере */
function makeState(opts: {
  round?: number;
  multiplier?: number;
  revealedCount?: number;
  revealedValue?: number;
  totalItems?: number;
  cash?: number;
  phase?: 'ready' | 'auction';
}): PublicGame {
  const cash = opts.cash ?? 500_000;
  const me: PublicPlayer = {
    id: 'me',
    name: 'Бот',
    cash,
    startCash: cash,
    ante: 0,
    online: true,
    passed: false,
    bidPlaced: false,
    inventoryValue: 0,
    isHost: false,
    ready: false,
  };
  const rival: PublicPlayer = { ...me, id: 'rival', name: 'Соперник', cash: cash * 2 };
  return {
    id: 'g1',
    code: 'TEST',
    phase: opts.phase ?? 'auction',
    players: [me, rival],
    board: { w: 12, h: 16, cells: [], lots: [] },
    items: [],
    auction:
      opts.phase === 'ready'
        ? null
        : {
            board: 'prize',
            lotIndex: 0,
            round: opts.round ?? 3,
            multiplier: opts.multiplier ?? 1.3,
            phase: 'bid',
            totalItems: opts.totalItems ?? 40,
            revealedCount: opts.revealedCount ?? 20,
            revealedValue: opts.revealedValue ?? 1_000_000,
            rarityCounts: {},
          },
    deadline: Date.now() + 30_000,
    log: [],
  };
}

function meOf(state: PublicGame): PublicPlayer {
  return state.players[0];
}

describe('оценка стола по раскрытой части', () => {
  it('экстраполирует скрытые предметы по раскрытым', () => {
    const state = makeState({ revealedCount: 20, totalItems: 40, revealedValue: 1_000_000 });
    const estimate = estimateTableValue(state);
    // раскрыта половина на миллион → полный стол около двух миллионов (плюс бонус за скрытое)
    expect(estimate).toBeGreaterThan(1_900_000);
    expect(estimate).toBeLessThan(2_400_000);
  });

  it('при малой доле раскрытого оценка не улетает в бесконечность', () => {
    const state = makeState({ revealedCount: 1, totalItems: 55, revealedValue: 30_000 });
    const estimate = estimateTableValue(state);
    expect(estimate).toBeGreaterThan(0);
    // доля раскрытого снизу ограничена 12%, поэтому оценка не больше ~9× видимого (плюс бонус)
    expect(estimate).toBeLessThanOrEqual(Math.round((30_000 / 0.12) * 1.08) + 1);
  });

  it('без торгов оценка нулевая', () => {
    expect(estimateTableValue(makeState({ phase: 'ready' }))).toBe(0);
  });
});

describe('готовность платить зависит от характера', () => {
  // в этих тестах важно сравнить характеры между собой, поэтому денег заведомо
  // больше оценки стола — иначе все значения упрутся в потолок наличных
  const richState = () => makeState({ cash: 20_000_000 });

  it('азартный платит больше осторожного при одинаковом столе', () => {
    const state = richState();
    const rng = () => 0.5; // одинаковый «бросок» для чистого сравнения
    const gambler = willingnessToPay(state, meOf(state), BOT_CHARACTERS.gambler, { morale: 0.5, ambition: 1 }, rng);
    const cautious = willingnessToPay(state, meOf(state), BOT_CHARACTERS.cautious, { morale: 0.5, ambition: 1 }, rng);
    expect(gambler).toBeGreaterThan(cautious);
  });

  it('никогда не превышает наличные бота', () => {
    const state = makeState({ cash: 90_000, revealedValue: 5_000_000, revealedCount: 40, totalItems: 40 });
    for (const id of BOT_CHARACTER_IDS) {
      const pay = willingnessToPay(state, meOf(state), BOT_CHARACTERS[id], { morale: 0.1, ambition: 1.5 }, () => 0.9);
      expect(pay).toBeLessThanOrEqual(90_000);
    }
  });

  it('погоня за топ-10 (высокая амбиция) повышает готовность платить', () => {
    const state = richState();
    const c = BOT_CHARACTERS.calculating;
    const calm = willingnessToPay(state, meOf(state), c, { morale: 0.5, ambition: 1 }, () => 0.5);
    const hungry = willingnessToPay(state, meOf(state), c, { morale: 0.5, ambition: 1.5 }, () => 0.5);
    expect(hungry).toBeGreaterThan(calm);
  });

  it('проигрышная серия (низкое morale) поднимает агрессию у мстительного', () => {
    const state = richState();
    const c = BOT_CHARACTERS.vengeful;
    const good = willingnessToPay(state, meOf(state), c, { morale: 0.9, ambition: 1 }, () => 0.5);
    const tilted = willingnessToPay(state, meOf(state), c, { morale: 0.0, ambition: 1 }, () => 0.5);
    expect(tilted).toBeGreaterThan(good);
  });

  it('амбиция ограничена сверху, чтобы бот не сходил с ума', () => {
    const state = richState();
    const c = BOT_CHARACTERS.calculating;
    const normal = willingnessToPay(state, meOf(state), c, { morale: 0.5, ambition: 1.6 }, () => 0.5);
    const absurd = willingnessToPay(state, meOf(state), c, { morale: 0.5, ambition: 99 }, () => 0.5);
    expect(absurd).toBe(normal);
  });
});

describe('решения в партии', () => {
  it('ставка никогда не превышает наличные и не отрицательна', () => {
    for (const id of BOT_CHARACTER_IDS) {
      const character: BotCharacter = BOT_CHARACTERS[id];
      for (let seed = 1; seed <= 40; seed++) {
        const rng = mulberry32(seed);
        const state = makeState({ cash: 120_000, revealedValue: 900_000, revealedCount: 30, totalItems: 40 });
        const d = decideBid(state, meOf(state), character, { morale: 0.4, ambition: 1.2 }, rng);
        expect(d.value.amount).toBeGreaterThanOrEqual(0);
        expect(d.value.amount).toBeLessThanOrEqual(120_000);
        if (d.value.pass) expect(d.value.amount).toBe(0);
        expect(d.delayMs).toBeGreaterThan(0);
      }
    }
  });

  it('бот подтверждает вход, когда денег хватает, и отказывается, когда нет', () => {
    for (const id of BOT_CHARACTER_IDS) {
      const character = BOT_CHARACTERS[id];
      for (let seed = 1; seed <= 20; seed++) {
        const rng = mulberry32(seed);
        const rich = makeState({ phase: 'ready', cash: 500_000 });
        const okDecision = decideEntry(rich, meOf(rich), character, ENTRY, rng);
        expect(okDecision.value).toBe(true);
        expect(okDecision.delayMs).toBeGreaterThan(0);

        const poor = makeState({ phase: 'ready', cash: ENTRY - 1 });
        expect(decideEntry(poor, meOf(poor), character, ENTRY, rng).value).toBe(false);
      }
    }
  });

  it('без денег бот пасует, а не ставит отрицательное', () => {
    const state = makeState({ cash: 500 });
    const d = decideBid(state, meOf(state), BOT_CHARACTERS.gambler, { morale: 0.5, ambition: 1.5 }, () => 0.99);
    expect(d.value.pass).toBe(true);
    expect(d.value.amount).toBe(0);
  });

  it('задержка реакции попадает в диапазон характера', () => {
    for (const id of BOT_CHARACTER_IDS) {
      const c = BOT_CHARACTERS[id];
      for (let seed = 1; seed <= 20; seed++) {
        const delay = reactionDelay(c, mulberry32(seed));
        expect(delay).toBeGreaterThanOrEqual(c.reaction[0] * 1000);
        expect(delay).toBeLessThanOrEqual(c.reaction[1] * 1000);
      }
    }
  });
});

describe('характеры различимы', () => {
  it('каждый характер занимает свою нишу по средней ставке', () => {
    // усредняем по множеству партий: отдельные решения шумные, среднее — устойчиво
    const averages: Record<string, number> = {};
    for (const id of BOT_CHARACTER_IDS) {
      let sum = 0;
      const n = 200;
      for (let seed = 1; seed <= n; seed++) {
        const state = makeState({ cash: 500_000 });
        const d = decideBid(state, meOf(state), BOT_CHARACTERS[id], { morale: 0.5, ambition: 1 }, mulberry32(seed));
        sum += d.value.amount;
      }
      averages[id] = sum / n;
    }
    // азартный в среднем ставит больше осторожного — это и есть «характер»
    expect(averages.gambler).toBeGreaterThan(averages.cautious);
    // расчётливый не равен ни азартному, ни осторожному
    expect(averages.calculating).not.toBe(averages.gambler);
    expect(averages.calculating).not.toBe(averages.cautious);
    // все характеры дают ненулевые ставки (боты действительно играют)
    for (const id of BOT_CHARACTER_IDS) expect(averages[id]).toBeGreaterThan(0);
  });

  it('у каждого характера заполнены все параметры и вес', () => {
    for (const id of BOT_CHARACTER_IDS) {
      const c = BOT_CHARACTERS[id];
      expect(c.id).toBe(id);
      expect(c.name.length).toBeGreaterThan(0);
      expect(c.weight).toBeGreaterThan(0);
      expect(c.risk).toBeGreaterThanOrEqual(0);
      expect(c.risk).toBeLessThanOrEqual(1);
      expect(c.reaction[0]).toBeLessThan(c.reaction[1]);
    }
  });
});

describe('округление сумм «по-человечески»', () => {
  it('крупные суммы округляются до круглых чисел', () => {
    // при любом броске результат кратен хотя бы тысяче
    for (const r of [0, 0.2, 0.4, 0.6, 0.8, 0.99]) {
      const v = roundAmount(47_321, () => r);
      expect(v % 1000).toBe(0);
      expect(v).toBeGreaterThan(0);
    }
  });

  it('мелкие суммы не обнуляются', () => {
    expect(roundAmount(500, () => 0.9)).toBe(500);
  });
});
