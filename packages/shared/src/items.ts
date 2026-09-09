// Каталог предметов и генераторы
import type { ItemDef, ItemInstance, Rarity } from './types';
import { STARTER_PACK_MAX, STARTER_PACK_MIN } from './constants';

export const RARITY_VALUE_RANGE: Record<Rarity, [number, number]> = {
  white: [2_000, 8_000],
  green: [8_000, 20_000],
  blue: [20_000, 45_000],
  purple: [45_000, 90_000],
  gold: [90_000, 160_000],
  red: [160_000, 300_000],
};

const NAMES: Record<Rarity, string[]> = {
  white: [
    'Пыльная ваза', 'Гипсовая статуэтка', 'Жестяная кружка', 'Деревянный гребешок',
    'Стеклянный шар', 'Бумажный веер', 'Латунная пуговица', 'Керамический горшок',
    'Потёртая колода карт',
  ],
  green: [
    'Резная шкатулка', 'Бронзовое зеркальце', 'Шёлковый платок', 'Нефритовый браслет',
    'Фарфоровая чашка', 'Медный чайник', 'Янтарная бусина', 'Свиток с пейзажем',
    'Набор резцов мастера',
  ],
  blue: [
    'Серебряная брошь', 'Лаковый ларец', 'Изумрудная подвеска', 'Старинный компас',
    'Шпалера с грифоном', 'Сапфировое кольцо', 'Кинжал с гравировкой', 'Позолоченный канделябр',
    'Карта неведомых земель',
  ],
  purple: [
    'Амулет лунного света', 'Меч из звёздной стали', 'Корона горного хрусталя',
    'Свиток древних заклинаний', 'Часы с духом-кукушкой', 'Жезл иллюзий',
    'Доспех рыцаря тумана', 'Шкатулка Пандоры', 'Хрустальный шар предсказателя',
  ],
  gold: [
    'Кубок вечного пира', 'Тиара заката', 'Реликвия морского бога', 'Скипетр громовержца',
    'Зеркало истины', 'Ключ от врат бездны', 'Диадема полярной звезды', 'Грифон из чистого золота',
    'Якорь «Надежда»',
  ],
  red: [
    'Сердце дракона', 'Корона падшего короля', 'Око всевидящего', 'Печать первостихий',
    'Клинок судьбы', 'Грааль рассвета', 'Плащ невидимого императора', 'Ядро вечности',
  ],
};

export const ITEM_CATALOG: ItemDef[] = Object.entries(NAMES).flatMap(([rarity, names]) =>
  names.map((name, i) => {
    const [minValue, maxValue] = RARITY_VALUE_RANGE[rarity as Rarity];
    return { id: rarity + '-' + i, name, rarity: rarity as Rarity, minValue, maxValue };
  }),
);

/** Детерминированный ГПСЧ (mulberry32) */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomInt(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

export function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

const DIM_WEIGHTS: [number, number][] = [[1, 30], [2, 26], [3, 20], [4, 14], [5, 10]];

/** Случайный размер стороны предмета (1..5), мелкие предметы чаще */
export function randomDim(rng: () => number): number {
  let r = rng() * 100;
  for (const [d, w] of DIM_WEIGHTS) {
    r -= w;
    if (r < 0) return d;
  }
  return 1;
}

export const UNIFORM_RARITY: Record<Rarity, number> = {
  white: 1, green: 1, blue: 1, purple: 1, gold: 1, red: 1,
};

export const PRIZE_RARITY: Record<Rarity, number> = {
  white: 26, green: 24, blue: 20, purple: 15, gold: 10, red: 5,
};

function pickRarity(rng: () => number, weights: Record<Rarity, number>): Rarity {
  const entries = Object.entries(weights) as [Rarity, number][];
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = rng() * total;
  for (const [rarity, w] of entries) {
    r -= w;
    if (r < 0) return rarity;
  }
  return entries[entries.length - 1][0];
}

export function generateItem(
  rng: () => number,
  opts: { rarityWeights?: Record<Rarity, number> } = {},
): ItemInstance {
  const rarity = pickRarity(rng, opts.rarityWeights ?? UNIFORM_RARITY);
  const pool = ITEM_CATALOG.filter((d) => d.rarity === rarity);
  const def = pick(rng, pool);
  const [min, max] = RARITY_VALUE_RANGE[rarity];
  const value = Math.round(randomInt(rng, min, max) / 100) * 100;
  return {
    id: crypto.randomUUID(),
    defId: def.id,
    name: def.name,
    rarity,
    value,
    w: randomDim(rng),
    h: randomDim(rng),
  };
}

/**
 * Стартовый набор нового игрока: случайные предметы суммарной
 * стоимостью примерно в STARTER_PACK_MIN..STARTER_PACK_MAX (~300 000).
 */
export function generateStarterPack(rng: () => number): ItemInstance[] {
  for (let attempt = 0; attempt < 80; attempt++) {
    const pack: ItemInstance[] = [];
    let total = 0;
    while (total < STARTER_PACK_MIN && pack.length < 12) {
      const item = generateItem(rng);
      pack.push(item);
      total += item.value;
    }
    if (total >= STARTER_PACK_MIN && total <= STARTER_PACK_MAX) return pack;
  }
  // фолбэк (крайне маловероятно): отдаём то, что накопилось
  const pack: ItemInstance[] = [];
  let total = 0;
  while (total < STARTER_PACK_MIN && pack.length < 12) {
    const item = generateItem(rng);
    pack.push(item);
    total += item.value;
  }
  return pack;
}

export function itemsTotal(items: readonly { value: number }[]): number {
  return items.reduce((s, i) => s + i.value, 0);
}

/** Отформатировать число как игровую валюту (без неразрывных пробелов) */
export function fmt(n: number): string {
  return n.toLocaleString('ru-RU').replace(new RegExp(String.fromCharCode(160) + '|' + String.fromCharCode(8239), 'g'), ' ');
}
