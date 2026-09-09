// Сеты убежища: тематические коллекции предметов с бонусами
import type { Rarity } from './types';

export interface SetDefinition {
  id: string;
  /** название сета */
  name: string;
  /** подзаголовок-роль (трактирщик, моряк...) */
  subtitle: string;
  lore: string;
  bonusTitle: string;
  bonusText: string;
  /** реализованы ли бонусы (false — «скоро», показывается в UI) */
  live: boolean;
  /** id бонусов (для применения в игре) */
  bonusIds: string[];
  /** 5 предметов каталога (defId) */
  itemIds: string[];
}

export const SETS: SetDefinition[] = [
  {
    id: 'tavern',
    name: 'Тёплый очаг',
    subtitle: 'трактирщик',
    lore: '«В этом трактире не отказывают даже бродяге без гроша»',
    bonusTitle: 'Завсегдатай',
    bonusText: 'Торговец покупает на +5% дороже. Доход выставочного зала +5% (зал — скоро).',
    live: true,
    bonusIds: ['trader_bonus'],
    itemIds: ['white-2', 'white-7', 'white-3', 'green-5', 'white-8'],
  },
  {
    id: 'crafter',
    name: 'Золотые руки',
    subtitle: 'ремесленник',
    lore: '«Вещь, сделанная с любовью, служит вдвое дольше»',
    bonusTitle: 'Подмастерье',
    bonusText: 'Крафт −10% стоимости и времени, шанс крита +10% (мастерская — скоро).',
    live: false,
    bonusIds: ['craft_bonus'],
    itemIds: ['green-0', 'green-4', 'green-6', 'white-6', 'green-8'],
  },
  {
    id: 'alchemist',
    name: 'В поисках философского камня',
    subtitle: 'алхимик',
    lore: '«Всё, что блестит, может стать золотом. Остальное — станет пеплом»',
    bonusTitle: 'Трансмутация',
    bonusText: 'Раз в сутки: 3 белых предмета → случайный зелёный (10% шанс синего).',
    live: true,
    bonusIds: ['transmutation'],
    itemIds: ['white-0', 'white-1', 'white-5', 'green-1', 'red-7'],
  },
  {
    id: 'navigator',
    name: 'Компас и семь ветров',
    subtitle: 'мореплаватель',
    lore: '«Компас врёт только тем, кто не хочет вернуться»',
    bonusTitle: 'Попутный ветер',
    bonusText: 'Экспедиции −25% времени, +10% успех, меньше потерь (экспедиции — скоро).',
    live: false,
    bonusIds: ['expedition_bonus'],
    itemIds: ['blue-3', 'blue-6', 'blue-1', 'green-2', 'blue-8'],
  },
  {
    id: 'mage',
    name: 'Гильдия тайных искусств',
    subtitle: 'маг',
    lore: '«Знание не стоит ничего. Знание о будущем — всё»',
    bonusTitle: 'Третий глаз',
    bonusText: '+1 личное раскрытие предмета в каждом лоте. Жетоны прорицания +25% быстрее (жетоны — скоро).',
    live: true,
    bonusIds: ['reveal_plus_one'],
    itemIds: ['purple-3', 'purple-5', 'purple-0', 'white-4', 'purple-8'],
  },
  {
    id: 'knight',
    name: 'Странствующий рыцарь',
    subtitle: 'защитник',
    lore: '«Мой лот — моя крепость»',
    bonusTitle: 'Кодекс чести',
    bonusText: '+10 секунд на ставки (всем за столом).',
    live: true,
    bonusIds: ['bid_time_bonus'],
    itemIds: ['purple-6', 'purple-1', 'purple-2', 'blue-4', 'gold-7'],
  },
  {
    id: 'sailor',
    name: 'Легенда семи морей',
    subtitle: 'моряк',
    lore: '«Пират не копит сокровища. Пират заставляет их работать»',
    bonusTitle: 'Золотая лихорадка',
    bonusText: 'Доход выставочного зала +25%, сокровищницы +20% (зал и казна — скоро).',
    live: false,
    bonusIds: ['income_bonus'],
    itemIds: ['gold-0', 'gold-2', 'gold-5', 'gold-6', 'gold-8'],
  },
  {
    id: 'merchant',
    name: 'Призрак рынка',
    subtitle: 'купец-контрабандист',
    lore: '«Комиссию платят те, кто не умеет торговать»',
    bonusTitle: 'Своя цена',
    bonusText: 'Твоя комиссия барахолки −2% (минимум 3%). Твои лоты живут +2 дня.',
    live: true,
    bonusIds: ['market_fee_discount', 'listing_ttl_bonus'],
    itemIds: ['gold-4', 'blue-0', 'blue-5', 'blue-2', 'red-6'],
  },
  {
    id: 'dragon',
    name: 'Наследие дракона',
    subtitle: 'разрушитель',
    lore: '«Когда дракон входит в зал, молоток аукциониста дрожит»',
    bonusTitle: 'Аура императора',
    bonusText: '+10% к стартовому кэшу партии. В первом раунде лота видишь редкость самого дорогого скрытого предмета.',
    live: true,
    bonusIds: ['start_cash_bonus', 'dragon_hint'],
    itemIds: ['red-0', 'red-1', 'red-4', 'red-2', 'red-3'],
  },
];

export function findSet(id: string): SetDefinition | undefined {
  return SETS.find((s) => s.id === id);
}

// ---------- Состояние убежища ----------

export interface ShowcaseSlot {
  defId: string;
  name: string;
  rarity: Rarity;
  placed: boolean;
  itemId?: string;
  value?: number;
  w?: number;
  h?: number;
}

export interface SetProgress {
  setId: string;
  name: string;
  subtitle: string;
  lore: string;
  bonusTitle: string;
  bonusText: string;
  live: boolean;
  slots: ShowcaseSlot[];
  placedCount: number;
  active: boolean;
}

export interface HideoutState {
  sets: SetProgress[];
  activeBonusIds: string[];
  completedSets: number;
  totalSets: number;
  metaActive: boolean;
  lastTransmuteAt: number;
}
