// Особые карточки: комплекты «Анализаторы» и «Усилители», магазин и колесо фортуны.
// Билет на крутку колеса стоит 1 «Пыльную вазу»; чем сильнее карточка, тем ниже шанс её выпадения.
import type { Rarity } from './types';

export type CardSetId = 'analyzers' | 'amplifiers';

/** Комплект особых карточек */
export interface CardSetDef {
  id: CardSetId;
  name: string;
  icon: string;
  desc: string;
}

export interface CardDef {
  id: string;
  setId: CardSetId;
  name: string;
  desc: string;
  /** сила карточки (1..4): чем больше, тем сильнее и тем ниже шанс выпадения */
  power: number;
  /** вес выпадения в колесе фортуны (в сумме по всем карточкам — 100) */
  weight: number;
  /** анализаторы: сколько скрытых предметов стола раскрывает */
  reveals?: number;
  /** усилители: в какое качество превращает случайный предмет инвентаря */
  rarity?: Rarity;
}

export const CARD_SETS: CardSetDef[] = [
  {
    id: 'analyzers',
    name: 'Анализаторы',
    icon: '🔎',
    desc: 'Личные карточки для партии: раскрывают редкость случайных скрытых предметов на столе — границы предметов подсвечиваются цветом их редкости. Видит только владелец, другие игроки ничего не замечают.',
  },
  {
    id: 'amplifiers',
    name: 'Усилители',
    icon: '⚡',
    desc: 'Превращают случайный предмет вашего инвентаря (слабее цели) в случайный предмет нужного качества. Используются на странице «Инвентарь».',
  },
];

export const CARD_DEFS: CardDef[] = [
  {
    id: 'analyzer-small',
    setId: 'analyzers',
    name: 'Малый анализатор редкости',
    desc: 'Раскрывает редкость 2 случайных скрытых предметов на столе: их границы подсвечиваются цветом редкости. Видит только владелец.',
    power: 1,
    weight: 30,
    reveals: 2,
  },
  {
    id: 'analyzer-medium',
    setId: 'analyzers',
    name: 'Средний анализатор редкости',
    desc: 'Раскрывает редкость 4 случайных скрытых предметов на столе: их границы подсвечиваются цветом редкости. Видит только владелец.',
    power: 2,
    weight: 16,
    reveals: 4,
  },
  {
    id: 'analyzer-large',
    setId: 'analyzers',
    name: 'Большой анализатор редкости',
    desc: 'Раскрывает редкость 6 случайных скрытых предметов на столе: их границы подсвечиваются цветом редкости. Видит только владелец.',
    power: 3,
    weight: 10,
    reveals: 6,
  },
  {
    id: 'analyzer-perfect',
    setId: 'analyzers',
    name: 'Совершенный анализатор редкости',
    desc: 'Раскрывает редкость 8 случайных скрытых предметов на столе: их границы подсвечиваются цветом редкости. Видит только владелец.',
    power: 4,
    weight: 4,
    reveals: 8,
  },
  {
    id: 'amp-blue',
    setId: 'amplifiers',
    name: 'Усилитель: синее качество',
    desc: 'Превращает 1 случайный предмет инвентаря слабее синего в случайный синий предмет.',
    power: 1,
    weight: 20,
    rarity: 'blue',
  },
  {
    id: 'amp-yellow',
    setId: 'amplifiers',
    name: 'Усилитель: жёлтое качество',
    desc: 'Превращает 1 случайный предмет инвентаря слабее жёлтого в случайный жёлтый предмет.',
    power: 2,
    weight: 12,
    rarity: 'yellow',
  },
  {
    id: 'amp-gold',
    setId: 'amplifiers',
    name: 'Усилитель: золотое качество',
    desc: 'Превращает 1 случайный предмет инвентаря слабее золотого в случайный золотой предмет.',
    power: 3,
    weight: 6,
    rarity: 'gold',
  },
  {
    id: 'amp-red',
    setId: 'amplifiers',
    name: 'Усилитель: красное качество',
    desc: 'Превращает 1 случайный предмет инвентаря слабее красного в случайный красный предмет.',
    power: 4,
    weight: 2,
    rarity: 'red',
  },
];

/** Предмет-билет для колеса фортуны: 1 «Пыльная ваза» = 1 крутка */
export const WHEEL_TICKET_DEF_ID = 'white-0';
export const WHEEL_TICKET_NAME = 'Пыльная ваза';

// ---------- крафт ----------

/** Сколько предметов одного качества нужно на крафт */
export const CRAFT_ITEMS_PER_RECIPE = 3;

export interface CraftRecipe {
  id: string;
  /** что получится */
  name: string;
  desc: string;
  /** требуемое качество всех трёх предметов */
  fromRarity: Rarity;
  icon: string;
}

/**
 * Рецепты крафта: три предмета ОДНОГО качества категории превращаются
 * в один предмет. Отдельно стоит билет колеса фортуны — «Пыльная ваза»:
 * её делают из любых трёх предметов одного цвета, поэтому она доступна
 * на любом этапе, а не только когда повезло с редкими предметами.
 *
 * Порядок редкостей — от белого к красному, поэтому «следующее качество»
 * определяется по RARITY_ORDER.
 */
export const CRAFT_RECIPES: CraftRecipe[] = [
  { id: 'vase-white', name: WHEEL_TICKET_NAME, desc: 'билет колеса фортуны', fromRarity: 'white', icon: '🏺' },
  { id: 'vase-green', name: WHEEL_TICKET_NAME, desc: 'билет колеса фортуны', fromRarity: 'green', icon: '🏺' },
  { id: 'vase-blue', name: WHEEL_TICKET_NAME, desc: 'билет колеса фортуны', fromRarity: 'blue', icon: '🏺' },
  { id: 'vase-purple', name: WHEEL_TICKET_NAME, desc: 'билет колеса фортуны', fromRarity: 'purple', icon: '🏺' },
  { id: 'vase-gold', name: WHEEL_TICKET_NAME, desc: 'билет колеса фортуны', fromRarity: 'gold', icon: '🏺' },
  { id: 'vase-yellow', name: WHEEL_TICKET_NAME, desc: 'билет колеса фортуны', fromRarity: 'yellow', icon: '🏺' },
  { id: 'vase-red', name: WHEEL_TICKET_NAME, desc: 'билет колеса фортуны', fromRarity: 'red', icon: '🏺' },
];

/** Рецепт крафта вазы для указанного качества */
export function vaseRecipeFor(rarity: Rarity): CraftRecipe | undefined {
  return CRAFT_RECIPES.find((r) => r.fromRarity === rarity);
}

/** Продолжительность кручения колеса фортуны, мс (по заданию — 5 секунд) */
export const WHEEL_SPIN_MS = 5_000;

/** Порядок секторов на колесе (индекс = сектор, против часовой от метки) */
export const WHEEL_SEGMENTS: CardDef[] = CARD_DEFS;

export function findCard(id: string): CardDef | undefined {
  return CARD_DEFS.find((c) => c.id === id);
}

/** Случайная карточка по весам (чем сильнее — тем меньше шанс) */
export function pickCardByWeight(rng: () => number = Math.random): CardDef {
  const total = CARD_DEFS.reduce((s, c) => s + c.weight, 0);
  let r = rng() * total;
  for (const c of CARD_DEFS) {
    r -= c.weight;
    if (r < 0) return c;
  }
  return CARD_DEFS[CARD_DEFS.length - 1];
}

/** Суммарный вес комплекта (для отображения шансов в магазине) */
export function cardSetWeight(setId: CardSetId): number {
  return CARD_DEFS.filter((c) => c.setId === setId).reduce((s, c) => s + c.weight, 0);
}

/** Шанс выпадения карточки в процентах (по весам колеса) */
export function cardChance(card: CardDef): number {
  const total = CARD_DEFS.reduce((s, c) => s + c.weight, 0);
  return (card.weight / total) * 100;
}
