// Характеры ботов и «личности»: психологические архетипы, имена, аватары.
// Боты — обычные игроки без преимуществ, но с разным поведением в торгах.

export type BotCharacterId =
  | 'gambler'
  | 'cautious'
  | 'calculating'
  | 'greedy'
  | 'vengeful'
  | 'panicky';

/**
 * Параметры характера. Все значения — множители/вероятности, которые
 * используются мозгом бота при принятии решений (см. apps/server/src/bots/brain.ts).
 */
export interface BotCharacter {
  id: BotCharacterId;
  /** название характера (показывается в админке/логах) */
  name: string;
  /** краткое описание психотипа */
  description: string;
  /** вес при случайном выборе характера новому боту */
  weight: number;
  /**
   * Склонность к риску 0..1: насколько охотно бот поднимает ставку выше
   * ожидаемой стоимости стола. 0.5 — «по расчёту».
   */
  risk: number;
  /** надбавка к порогу паса: чем выше, тем раньше сдаётся (0.2 — осторожный, −0.15 — азартный) */
  caution: number;
  /**
   * Жадность 0..1: насколько сильно бот старается выиграть лот,
   * даже когда цена уже выше оценки (переплата «за престиж»).
   */
  greed: number;
  /** эмоциональность 0..1: влияние проигрышей/выигрышей на следующие решения */
  tilt: number;
  /** базовая пауза перед решением, секунды (мин/макс) — «человеческая» реакция */
  reaction: [number, number];
  /** вероятность сделать «глупость» (переоценить/недооценить стол) 0..1 */
  blunder: number;
  /** насколько охотно тратит анализаторы редкости: 0 — копит, 1 — применяет сразу */
  cardEagerness: number;
  /** скорость, с которой бот «сгорает» и уходит на паузу после проигрыша (влияет на сессии) */
  sessionPatience: number;
}

/** Архетипы характеров. Распределение задано весами — так, чтобы людской стол был разнообразным. */
export const BOT_CHARACTERS: Record<BotCharacterId, BotCharacter> = {
  // «Азартный» — риск-сикер: перебивает, редко пасует, любит переплатить за адреналин
  gambler: {
    id: 'gambler',
    name: 'Азартный',
    description: 'Риск-сикер: перебивает ставки, редко пасует, легко переплачивает за азарт.',
    weight: 20,
    risk: 0.82,
    caution: -0.15,
    greed: 0.75,
    tilt: 0.55,
    reaction: [1.5, 5],
    blunder: 0.14,
    cardEagerness: 0.7,
    sessionPatience: 0.8,
  },
  // «Осторожный» — риск-эйверс: ставит мало, пасует при перегреве цены
  cautious: {
    id: 'cautious',
    name: 'Осторожный',
    description: 'Риск-эйверс: ставит мало, пасует, как только цена уходит выше оценки.',
    weight: 20,
    risk: 0.24,
    caution: 0.22,
    greed: 0.25,
    tilt: 0.3,
    reaction: [3, 10],
    blunder: 0.06,
    cardEagerness: 0.45,
    sessionPatience: 0.6,
  },
  // «Расчётливый» — прагматик: считает EV, ставит около оценки
  calculating: {
    id: 'calculating',
    name: 'Расчётливый',
    description: 'Прагматик: считает ожидаемую стоимость стола и почти не отклоняется от расчёта.',
    weight: 20,
    risk: 0.5,
    caution: 0.02,
    greed: 0.45,
    tilt: 0.2,
    reaction: [2, 7],
    blunder: 0.04,
    cardEagerness: 0.85,
    sessionPatience: 0.75,
  },
  // «Жадный» — максимизатор: целится в дорогие столы, торгуется до предела
  greedy: {
    id: 'greedy',
    name: 'Жадный',
    description: 'Максимизатор: идёт до предела, чтобы забрать стол целиком, не любит уступать.',
    weight: 15,
    risk: 0.68,
    caution: -0.05,
    greed: 0.95,
    tilt: 0.4,
    reaction: [2, 8],
    blunder: 0.1,
    cardEagerness: 0.55,
    sessionPatience: 0.9,
  },
  // «Мстительный» — эмоциональный: после проигрыша поднимает агрессию
  vengeful: {
    id: 'vengeful',
    name: 'Мстительный',
    description: 'Эмоциональный: тяжело переживает проигрыши и «отбивает» их повышенной агрессией.',
    weight: 12,
    risk: 0.66,
    caution: -0.08,
    greed: 0.7,
    tilt: 0.9,
    reaction: [1.5, 6],
    blunder: 0.16,
    cardEagerness: 0.5,
    sessionPatience: 0.7,
  },
  // «Новичок-паникёр» — тревожный: путается в оценке, ставит круглые суммы, суетится
  panicky: {
    id: 'panicky',
    name: 'Новичок-паникёр',
    description: 'Тревожный: плохо оценивает стол, ставит круглые суммы, суетится и ошибается.',
    weight: 13,
    risk: 0.42,
    caution: 0.12,
    greed: 0.35,
    tilt: 0.7,
    reaction: [1, 4],
    blunder: 0.3,
    cardEagerness: 0.95,
    sessionPatience: 0.5,
  },
};

export const BOT_CHARACTER_IDS: BotCharacterId[] = Object.keys(BOT_CHARACTERS) as BotCharacterId[];

/** Имя бота: «Имя Фамилия» — чтобы за столом не отличался от человека */
const BOT_NAMES: string[] = [
  'Артём Соколов', 'Марина Лебедева', 'Игорь Веснин', 'Даша Кириллова',
  'Павел Одинцов', 'Юля Романова', 'Стас Гончаров', 'Настя Белова',
  'Витя Крылов', 'Лена Морозова', 'Гриша Панов', 'Оля Ситникова',
  'Денис Шульгин', 'Кира Астахова', 'Рома Зимин', 'Света Ковалёва',
  'Тимур Бекетов', 'Аня Лаврова', 'Максим Ерохин', 'Ника Соловьёва',
  'Егор Тарасов', 'Полина Гущина', 'Слава Барсуков', 'Инна Рыбина',
  'Костя Мельник', 'Вера Дроздова', 'Лёша Панкратов', 'Женя Сорокина',
  'Миша Тихонов', 'Алиса Верещагина', 'Вадим Костин', 'Тася Ефимова',
  'Боря Наумов', 'Люба Савельева', 'Антон Жуков', 'Рита Ильина',
  'Сеня Кравцов', 'Марго Полякова', 'Дима Ушаков', 'Ксюша Родионова',
  'Яша Фомин', 'Нюра Ткачёва', 'Петя Сафонов', 'Зина Громова',
  'Сева Блинов', 'Ася Нечаева', 'Толя Русаков', 'Лида Пахомова',
];

/** Пул имён с запасом на парк ботов (44 по умолчанию) */
export function botName(index: number): string {
  return BOT_NAMES[index % BOT_NAMES.length];
}

export const BOT_NAME_COUNT = BOT_NAMES.length;

/** Палитра аватаров ботов — тёплые и холодные оттенки в духе интерфейса игры */
const AVATAR_COLORS: string[] = [
  '#f59e0b', '#38bdf8', '#a78bfa', '#34d399', '#fb7185',
  '#facc15', '#60a5fa', '#f472b6', '#4ade80', '#c084fc',
  '#fdba74', '#22d3ee', '#f87171', '#a3e635', '#e879f9',
  '#fbbf24', '#818cf8', '#2dd4bf', '#fb923c', '#94a3b8',
];

/**
 * Аватар бота — SVG data-URI с инициалами на цветном фоне.
 * Рисуется без внешних картинок, поэтому не требует файлов на диске.
 */
export function botAvatar(name: string, seed: number): string {
  const color = AVATAR_COLORS[Math.abs(seed) % AVATAR_COLORS.length];
  const parts = name.trim().split(/\s+/);
  const initials = ((parts[0]?.[0] ?? '?') + (parts[1]?.[0] ?? '')).toUpperCase();
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">' +
    '<rect width="64" height="64" rx="14" fill="' + color + '"/>' +
    '<text x="32" y="41" font-family="Arial,Helvetica,sans-serif" font-size="26" font-weight="700" ' +
    'fill="#0f172a" text-anchor="middle">' + initials + '</text></svg>';
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

/** Выбор характера по весам. rng — детерминированный генератор 0..1 */
export function pickCharacter(rng: () => number): BotCharacter {
  const ids = BOT_CHARACTER_IDS;
  const total = ids.reduce((sum, id) => sum + BOT_CHARACTERS[id].weight, 0);
  let roll = rng() * total;
  for (const id of ids) {
    roll -= BOT_CHARACTERS[id].weight;
    if (roll <= 0) return BOT_CHARACTERS[id];
  }
  return BOT_CHARACTERS[ids[ids.length - 1]];
}

/** Хеш строки в 32-битное число — сид для характера и аватара бота */
export function hashSeed(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Случайная длительность сессии бота (сколько партий подряд он готов играть) */
export function sessionGames(character: BotCharacter, rng: () => number): number {
  // нетерпеливые играют 1–2 партии, выдержанные — до 5
  const max = 1 + Math.round(character.sessionPatience * 4);
  return 1 + Math.floor(rng() * max);
}

/** Пауза между сессиями бота, мс: «ушёл по делам» */
export function sessionPauseMs(character: BotCharacter, rng: () => number): number {
  const base = 20_000 + rng() * 90_000;
  // терпеливые возвращаются быстрее
  return Math.round(base * (1.4 - character.sessionPatience * 0.6));
}
