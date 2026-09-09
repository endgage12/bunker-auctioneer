// «Тайный Санта» — аналог «Ящика диких» из Escape from Tarkov:
// предметы безвозвратно жертвуются, спустя время ящик спавнит случайные предметы.
// Чем выше сумма вложений, тем выше шанс редкого дропа и длиннее таймер.
import type { ItemInstance, Rarity } from './types';
import { RARITY_ORDER } from './types';
import { generateItem } from './items';

/** Сетка ящика Тайного Санты (ячейка 64px) */
export const SANTA_COLS = 9;
export const SANTA_ROWS = 9;

/** Минимум вложений для запуска круга (анти-абуз: одиночные вложения не дают дроп) */
export const SANTA_MIN_ITEMS = 3;

/** Нижняя граница «среднего» круга: от этой суммы таймер 30 секунд */
export const SANTA_MID_MIN = 100_000;
/** Верхняя граница «среднего» круга: свыше этой суммы таймер 60 секунд */
export const SANTA_MID_MAX = 250_000;

/**
 * Таймер дропа по сумме вложений:
 * < 100 000 — 15 сек, 100 000..250 000 — 30 сек, > 250 000 — 60 сек.
 */
export function santaTimerMs(value: number): number {
  if (value < SANTA_MID_MIN) return 15_000;
  if (value <= SANTA_MID_MAX) return 30_000;
  return 60_000;
}

// Веса редкостей на краях шкалы «ценности вложений» (0 и 250 000+).
// Между ними веса линейно интерполируются: чем больше вложено, тем выше шанс редкого дропа.
const SANTA_WEIGHT_AT_ZERO: Record<Rarity, number> = {
  white: 55, green: 30, blue: 10, purple: 4, gold: 1, red: 0,
};
const SANTA_WEIGHT_AT_MAX: Record<Rarity, number> = {
  white: 15, green: 25, blue: 25, purple: 18, gold: 12, red: 5,
};

/**
 * Веса редкостей дропа для суммы вложений value.
 * Шанс редкого предмета монотонно растёт вместе со стоимостью вложений.
 */
export function santaRewardRarityWeights(value: number): Record<Rarity, number> {
  const t = Math.max(0, Math.min(1, value / SANTA_MID_MAX));
  const out = {} as Record<Rarity, number>;
  for (const r of RARITY_ORDER) {
    out[r] = SANTA_WEIGHT_AT_ZERO[r] + (SANTA_WEIGHT_AT_MAX[r] - SANTA_WEIGHT_AT_ZERO[r]) * t;
  }
  return out;
}

/** Максимум предметов в одном дропе */
export const SANTA_MAX_REWARDS = 8;

/**
 * Количество предметов дропа: базовая часть растёт с суммой вложений
 * (2 + по предмету за каждые 100 000), плюс 25% шанс бонусного предмета.
 */
export function santaRewardCount(rng: () => number, value: number): number {
  const base = Math.min(SANTA_MAX_REWARDS, 2 + Math.floor(value / 100_000));
  const bonus = rng() < 0.25 ? 1 : 0;
  return Math.min(SANTA_MAX_REWARDS, base + bonus);
}

/** Сгенерировать один предмет дропа для суммы вложений value */
export function generateSantaReward(rng: () => number, value: number): ItemInstance {
  return generateItem(rng, { rarityWeights: santaRewardRarityWeights(value) });
}

/** Предмет в ящике Тайного Санты */
export interface SantaBoxItem {
  id: string;
  defId: string;
  name: string;
  rarity: Rarity;
  value: number;
  w: number;
  h: number;
  /** sacrifice — безвозвратно вложен и ждёт дропа; reward — выпал и можно забрать */
  kind: 'sacrifice' | 'reward';
  /** позиция в сетке 9x9 (у предметов из pending поля отсутствуют) */
  x?: number;
  y?: number;
}

/** Итог завершённого круга Тайного Санты (для модального окна) */
export interface SantaCycleResult {
  id: string;
  /** момент завершения круга */
  at: number;
  /** сколько предметов было вложено */
  itemsIn: number;
  /** сумма вложений */
  valueIn: number;
  /** сколько предметов получено */
  itemsOut: number;
  /** сумма полученного */
  valueOut: number;
}

/** Состояние ящика Тайного Санты игрока */
export interface SantaState {
  /** предметы, лежащие в ящике (вложения и дроп) */
  box: SantaBoxItem[];
  /** предметы дропа, которым не хватило клеток в ящике — появятся, как только место освободится */
  pending: SantaBoxItem[];
  /** сумма вложений текущего круга (0 — круг не идёт) */
  poolValue: number;
  /** момент появления дропа (null — круг не идёт) */
  deadline: number | null;
  /** итог последнего завершённого круга (null — кругов ещё не было) */
  lastCycle: SantaCycleResult | null;
}
