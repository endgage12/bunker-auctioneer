// Общие константы игры "Раз, два, продано!"

/** Размер игрового стола: ширина (ячейка 64px) */
export const GRID_W = 12;
/** Размер игрового стола: высота */
export const GRID_H = 16;

/** Сетка инвентаря: колонки (ячейка 64px) */
export const INV_COLS = 12;
/** Сетка инвентаря: строки (фиксированная высота) */
export const INV_ROWS = 24;

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;

/** Быстрый подбор: партия стартует автоматически, как только в комнате наберётся столько игроков */
export const AUTO_START_PLAYERS = 4;

/** Вступительная ставка: минимум и максимум */
export const ANTE_MIN = 30_000;
export const ANTE_MAX = 100_000;

/** Стартовый кошелёк нового игрока */
export const START_CASH = 500_000;

/** Новый игрок получает предметы суммарной стоимостью в этом диапазоне (~600k) */
export const STARTER_PACK_MIN = 560_000;
export const STARTER_PACK_MAX = 660_000;

/** Тайминги фаз, секунды */
export const BETTING_SECONDS = 60;
export const REVEAL_SECONDS = 7;
export const BID_SECONDS = 25;
export const RESOLVE_SECONDS = 8;

/**
 * Множители раундов торгов (правила NTE "Раз, два, продано!"):
 * в раундах 1-4 высшая ставка побеждает, только если она превышает
 * вторую по величине в указанное число раз; раунд 5 - безусловная победа.
 */
export const MULTIPLIERS = [2, 1.6, 1.3, 1.1, 1] as const;

/** Те же множители в процентах (целые числа — для точного сравнения без плавающей точки) */
export const MULTIPLIER_PCT = [200, 160, 130, 110, 100] as const;

/** Доля предметов лота, раскрываемая к началу раундов 1..4 (кумулятивно) */
export const REVEAL_FRACTIONS = [0.25, 0.5, 0.75, 1] as const;

/** Призовой стол формируется до ставок: минимальная суммарная стоимость предметов */
export const TABLE_VALUE_MIN = 300_000;
/** ...и максимальная */
export const TABLE_VALUE_MAX = 9_000_000;
