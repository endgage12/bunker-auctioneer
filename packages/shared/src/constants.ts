// Общие константы игры "Раз, два, продано!"

/**
 * Абсолютный минимум покрытия стола. Основное правило — TABLE_FILL_MIN (50%),
 * но оно ограничено ценностью: дешёвый стол физически не может занять много
 * клеток, иначе его стоимость улетает за целевую. Поэтому для дешёвых столов
 * покрытие снижается до этого порога.
 */
export const TABLE_FILL_ABS_MIN = 0.2;

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

/**
 * Сословия (залы) казино. У каждого — фиксированная плата за вход и
 * ПРЕДОПРЕДЕЛЁННАЯ ценность стола: она разыгрывается движком до начала партии
 * и не зависит от того, сколько поставили игроки. Это ставка «на стол», а не
 * аукцион входных взносов.
 */
export type TierId = 'bronze' | 'silver' | 'gold';

export interface TierDef {
  id: TierId;
  name: string;
  /** короткое описание атмосферы зала */
  tagline: string;
  /** фиксированная плата за вход, валюта */
  entry: number;
  /** минимальная и максимальная ценность стола (разыгрывается заранее) */
  tableMin: number;
  tableMax: number;
  /** рекомендуемый капитал, чтобы играть комфортно */
  recommendedCash: number;
  /** акцентный цвет интерфейса */
  color: string;
  /** эмодзи-иконка зала */
  icon: string;
}

/**
 * Минимальная ценность, которую стол может набрать при абсолютном минимуме
 * покрытия. Считается по самым дешёвым предметам каталога: ниже этого порога
 * зал открывать нельзя — стол всё равно выйдет дороже заявленного.
 */
export const TABLE_VALUE_FLOOR = (() => {
  const cells = Math.floor(12 * 16 * TABLE_FILL_ABS_MIN);
  // средняя цена за клетку у белых предметов — самая низкая в каталоге
  const cheapPerCell = 1379;
  return Math.round(cells * cheapPerCell * 1.2);
})();

export const TIERS: Record<TierId, TierDef> = {
  bronze: {
    id: 'bronze',
    name: 'Медный зал',
    tagline: 'Для первых шагов: вход дешёвый, стол скромный',
    entry: 10_000,
    tableMin: 80_000,
    tableMax: 180_000,
    recommendedCash: 30_000,
    color: '#d97706',
    icon: '🥉',
  },
  silver: {
    id: 'silver',
    name: 'Серебряный зал',
    tagline: 'Основной стол: заметный банк и серьёзные соперники',
    entry: 100_000,
    tableMin: 520_000,
    tableMax: 1_250_000,
    recommendedCash: 300_000,
    color: '#cbd5e1',
    icon: '🥈',
  },
  gold: {
    id: 'gold',
    name: 'Золотой зал',
    tagline: 'Высокие ставки: стол на миллионы и только сильные игроки',
    entry: 1_000_000,
    tableMin: 6_000_000,
    tableMax: 14_000_000,
    recommendedCash: 3_000_000,
    color: '#fbbf24',
    icon: '🥇',
  },
};

export const TIER_IDS: TierId[] = ['bronze', 'silver', 'gold'];

// ---------- прогрессия игрока ----------

/**
 * Ранги игрока. Открываются по накопленному итогу партий (сколько всего
 * заработано за карьеру), а не по текущему балансу — иначе серия проигрышей
 * откатывала бы прогресс назад и копить было бы незачем.
 */
export interface RankDef {
  id: string;
  /** название ранга */
  name: string;
  /** накопленный итог, с которого ранг доступен */
  minWinnings: number;
  /** какой зал открывает ранг */
  unlocks: TierId | null;
  color: string;
  icon: string;
}

export const RANKS: RankDef[] = [
  { id: 'novice', name: 'Новичок', minWinnings: 0, unlocks: null, color: '#94a3b8', icon: '🎲' },
  { id: 'amateur', name: 'Любитель', minWinnings: 150_000, unlocks: null, color: '#38bdf8', icon: '🃏' },
  { id: 'player', name: 'Игрок', minWinnings: 600_000, unlocks: 'silver', color: '#cbd5e1', icon: '🥈' },
  { id: 'master', name: 'Мастер', minWinnings: 2_500_000, unlocks: 'gold', color: '#fbbf24', icon: '🥇' },
  { id: 'legend', name: 'Легенда', minWinnings: 10_000_000, unlocks: null, color: '#f472b6', icon: '👑' },
];

export function rankForWinnings(totalWinnings: number): RankDef {
  let current = RANKS[0];
  for (const r of RANKS) {
    if (totalWinnings >= r.minWinnings) current = r;
  }
  return current;
}

/** Следующий ранг и сколько до него осталось (null — уже максимальный) */
export function nextRank(totalWinnings: number): { rank: RankDef; remaining: number } | null {
  for (const r of RANKS) {
    if (totalWinnings < r.minWinnings) return { rank: r, remaining: r.minWinnings - totalWinnings };
  }
  return null;
}

/**
 * Открыт ли зал для игрока. Кроме денег нужен ранг: так у игрока появляется
 * цель «дорасти до серебряного зала», а не просто «накопить на вход».
 */
export function tierUnlockedByRank(tierId: TierId, totalWinnings: number): boolean {
  for (const r of RANKS) {
    if (r.unlocks === tierId) return totalWinnings >= r.minWinnings;
  }
  return true; // зал без рангового требования
}

/** Награда за серию побед: чем длиннее серия, тем выше множитель призовых */
export const STREAK_BONUS_PER_WIN = 0.05;
export const STREAK_BONUS_MAX = 0.25;

export function streakBonus(streak: number): number {
  return Math.min(STREAK_BONUS_MAX, Math.max(0, streak - 1) * STREAK_BONUS_PER_WIN);
}

export function getTier(id: string): TierDef | null {
  return (TIERS as Record<string, TierDef | undefined>)[id] ?? null;
}

/** Зал по умолчанию (используется в тестах и как безопасный фолбэк) */
export const DEFAULT_TIER: TierDef = TIERS.bronze;

/**
 * Компенсация проигравшим, когда победитель переплатил за стол.
 * Каждый проигравший получает 10% от минуса победителя (ставка − стоимость стола).
 * Если победитель в плюсе — проигравшие не получают ничего, но и не теряют.
 */
export const COMPENSATION_RATE = 0.1;

/**
 * Какая доля ставки победителя в любом случае остаётся в банке и не может
 * быть выплачена проигравшим. Защита от «печати денег»: без неё переплата
 * при 3+ соперниках окупалась за счёт банка дома.
 */
export const COMPENSATION_FLOOR_SHARE = 0.5;

/** Стартовый кошелёк нового игрока */
export const START_CASH = 300_000;

/**
 * Новый игрок получает предметы суммарной стоимостью в этом диапазоне.
 * Нерф экономики: раньше новичок входил в игру сразу с ~1.1 млн состояния,
 * из-за чего деньги обесценивались и копить было незачем.
 */
export const STARTER_PACK_MIN = 340_000;
export const STARTER_PACK_MAX = 420_000;

/**
 * Доля номинала, которую платит торговец при мгновенной продаже предмета.
 * Это плата за удобство: барахолка даёт больше, но требует времени.
 * Раньше торговец платил 100% номинала, поэтому барахолка (1128 лотов против
 * 12 сделок) была не нужна — предметы превращались в деньги одной кнопкой.
 */
export const VENDOR_RATE = 0.7;

/** Тайминги фаз, секунды */
export const BETTING_SECONDS = 60;
export const REVEAL_SECONDS = 7;
export const BID_SECONDS = 45;
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

/** Минимальная доля клеток стола, занятая предметами */
export const TABLE_FILL_MIN = 0.5;
/** Максимальная доля клеток стола, занятая предметами */
export const TABLE_FILL_MAX = 0.95;
