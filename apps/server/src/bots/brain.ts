// Мозг бота: решения в партии на основе ТОЛЬКО публичного снимка состояния.
//
// Модель «человеческого» поведения:
//  — оценка скрытой стоимости стола по раскрытой части (с учётом ошибки характера);
//  — готовность платить = оценка × риск × жадность × состояние (tilt, цель топ-10);
//  — пауза перед решением, круглые суммы, «+1» поверх соперника;
//  — изредка — импульсивные ошибки (blunder).
import type { BotCharacter } from '@auctioneer/shared';
import type { PublicGame, PublicPlayer } from '@auctioneer/shared';

/** Внешние обстоятельства, влияющие на решения (цель попасть в топ-10 и т.п.) */
export interface BotPosture {
  /** 0..1: насколько бот «в ударе» (0.5 — нейтрально) */
  morale: number;
  /** 1 — обычная агрессия; >1 — бот отстаёт от топ-10 и рискует сильнее */
  ambition: number;
}

export const NEUTRAL_POSTURE: BotPosture = { morale: 0.5, ambition: 1 };

export interface Decision<T> {
  value: T;
  /** задержка перед действием, мс — «человеческая» реакция */
  delayMs: number;
  /** необязательная реплика за столом */
  say?: string;
}

/** Интерфейс ГПСЧ — в тестах подменяется детерминированным */
export type Rng = () => number;

export interface RoundInfo {
  round: number;
  multiplier: number;
  revealedCount: number;
  revealedValue: number;
  totalItems: number;
  phase: string;
}

export function roundInfo(state: PublicGame): RoundInfo | null {
  const a = state.auction;
  if (!a) return null;
  return {
    round: a.round,
    multiplier: a.multiplier,
    revealedCount: a.revealedCount,
    revealedValue: a.revealedValue,
    totalItems: a.totalItems,
    phase: a.phase,
  };
}

/**
 * Ожидаемая полная стоимость стола по раскрытой части.
 * Человек делает то же самое «на глазок»: делит видимое на долю раскрытого.
 */
export function estimateTableValue(state: PublicGame): number {
  const a = state.auction;
  if (!a || a.totalItems <= 0) return 0;
  const revealed = Math.max(1, a.revealedCount);
  const share = Math.min(1, revealed / a.totalItems);
  // при малой доле раскрытого оценка шумная — человек тоже гадает
  const raw = a.revealedValue / Math.max(0.12, share);
  // небольшой бонус за «неоткрытое»: чаще всего в столе есть дорогие предметы
  return Math.round(raw * 1.08);
}

/**
 * Сколько бот готов заплатить за стол. Учитывает:
 *  — характер (риск, осторожность, жадность),
 *  — состояние (morale/tilt, ambition — погоня за топ-10),
 *  — остаток раундов (в 5-м раунде решение последнее — можно дожать),
 *  — множитель раунда (в первых раундах переплата бессмысленна).
 */
export function willingnessToPay(
  state: PublicGame,
  me: PublicPlayer,
  character: BotCharacter,
  posture: BotPosture = NEUTRAL_POSTURE,
  rng: Rng = Math.random,
): number {
  const estimate = estimateTableValue(state);
  if (estimate <= 0) return 0;
  const info = roundInfo(state);

  // tilt: чем ниже morale, тем агрессивнее «отбив» (в пределах характера)
  const tiltKick = (0.5 - posture.morale) * character.tilt * 0.6;
  // ошибка оценки: паникёр путается сильнее, расчётливый почти нет
  const misread = (rng() * 2 - 1) * character.blunder;
  const base = 1 + character.risk * 0.35 + tiltKick + misread - character.caution * 0.35;
  const greed = 1 + character.greed * 0.12;
  const ambition = Math.max(0.7, Math.min(1.6, posture.ambition));

  // в ранних раундах бот не готов платить всё: раунд 5 — единственный «решающий»
  const roundFactor = info ? Math.min(1, 0.55 + info.round * 0.09) : 1;

  const budget = me.cash;
  return Math.max(0, Math.min(budget, Math.round(estimate * base * greed * ambition * roundFactor)));
}

/** Круглая сумма «по-человечески»: 47 300 → 45 000 или 50 000 */
export function roundAmount(amount: number, rng: Rng): number {
  if (amount < 1000) return Math.max(0, Math.floor(amount));
  const steps = [1000, 5000, 10_000, 25_000, 50_000];
  const step = steps[Math.min(steps.length - 1, Math.floor(rng() * steps.length))];
  const rounded = Math.round(amount / step) * step;
  return Math.max(0, rounded);
}

const ANTE_CHATTER = [
  'ну посмотрим, что там на столе',
  'в этот раз без глупостей',
  'вхожу, стол интересный',
  'люблю такие столы',
  'надеюсь, там что-то стоящее',
];

const PASS_CHATTER = [
  'дорого, пас',
  'не моя цена',
  'забирайте, я не жадный',
  'слишком круто для меня',
  'пусть забирает, посмотрим',
];

const BID_CHATTER = [
  'я в деле',
  'поднимаю',
  'этот стол будет мой',
  'рискну',
  'не уступлю',
];

function pick<T>(arr: T[], rng: Rng): T {
  return arr[Math.min(arr.length - 1, Math.floor(rng() * arr.length))];
}

/**
 * Решение о входе в партию. Плата за вход фиксирована залом, поэтому «решения
 * о сумме» больше нет — есть только готовность войти и темп реакции.
 * Возвращает паузу перед подтверждением, чтобы боты не жали кнопку мгновенно.
 */
export function decideEntry(
  state: PublicGame,
  me: PublicPlayer,
  character: BotCharacter,
  entry: number,
  rng: Rng = Math.random,
): Decision<boolean> {
  // Сомневающиеся (осторожные, паникёры) думают дольше перед входом
  const hesitation = 0.6 + (1 - character.risk) * 1.2 + (1 - character.greed) * 0.5;
  const canPay = me.cash >= entry;
  const say =
    rng() < 0.22 * character.blunder + 0.1
      ? pick(canPay ? ANTE_CHATTER : ['не хватает на вход', 'придётся пропустить'], rng)
      : undefined;
  return { value: canPay, delayMs: Math.round(reactionDelay(character, rng) * hesitation), say };
}

/** Решение в раунде слепых ставок */
export function decideBid(
  state: PublicGame,
  me: PublicPlayer,
  character: BotCharacter,
  posture: BotPosture = NEUTRAL_POSTURE,
  rng: Rng = Math.random,
): Decision<{ pass: boolean; amount: number }> {
  const info = roundInfo(state);
  const pay = willingnessToPay(state, me, character, posture, rng);
  const pending = state.players.filter((p) => !p.passed && p.id !== me.id);
  const rivalRich = pending.some((p) => p.cash > me.cash * 1.5);

  // В последнем раунде (безусловно) жадность дожимает: можно пойти выше оценки
  const lastRound = !!info && info.round >= 5;
  const threshold = lastRound ? pay * (1 + character.greed * 0.25) : pay;

  // Осторожные пасуют, если платить нечем или стол выглядит дешёвым
  let pass = threshold <= 0 || me.cash < 1000;
  if (!pass && rivalRich && character.risk < 0.4 && rng() < 0.35) pass = true;
  // иногда человек пасует «не вовремя» — импульс, а не расчёт
  if (!pass && rng() < character.blunder * 0.35) pass = true;

  if (pass) {
    return {
      value: { pass: true, amount: 0 },
      delayMs: reactionDelay(character, rng),
      say: rng() < 0.2 ? pick(PASS_CHATTER, rng) : undefined,
    };
  }

  // Ставка около готовности платить, с «магией чисел» и лёгким подъёмом на следующем раунде
  let amount = threshold * (0.6 + rng() * 0.4);
  amount = roundAmount(amount, rng);
  // «+1» поверх круглой суммы — как делают люди в спешке
  if (rng() < 0.18) amount += 1;
  amount = Math.max(0, Math.min(me.cash, Math.floor(amount)));
  if (amount === 0) {
    return { value: { pass: true, amount: 0 }, delayMs: reactionDelay(character, rng) };
  }
  const say = rng() < 0.12 + character.greed * 0.1 ? pick(BID_CHATTER, rng) : undefined;
  return { value: { pass: false, amount }, delayMs: reactionDelay(character, rng), say };
}

/** Пауза перед решением: у каждого характера свой темп */
export function reactionDelay(character: BotCharacter, rng: Rng = Math.random): number {
  const [min, max] = character.reaction;
  return Math.round((min + rng() * (max - min)) * 1000);
}

/**
 * Пора ли применить анализатор редкости.
 * Бот применяет карточку во время торгов, если он «любопытный» и ещё не применял в этом раунде.
 */
export function shouldUseAnalyzer(
  state: PublicGame,
  character: BotCharacter,
  alreadyUsedThisGame: number,
  rng: Rng = Math.random,
): boolean {
  const info = roundInfo(state);
  if (!info || info.phase !== 'bid') return false;
  if (alreadyUsedThisGame >= 2) return false; // не тратит весь запас за одну партию
  return rng() < character.cardEagerness * 0.5;
}

/** Что бот говорит после партии (реплика в лог) */
export function commentOnResult(place: number, players: number, character: BotCharacter, rng: Rng): string | null {
  if (rng() > 0.35 + character.tilt * 0.2) return null;
  if (place === 1) return pick(['отлично зашло', 'вот это я понимаю', 'спасибо за стол'], rng);
  if (place === players) return pick(['не мой день', 'слил вчистую', 'ладно, отыграюсь'], rng);
  return pick(['почти получилось', 'в следующий раз повезёт', 'нормально посидели'], rng);
}
