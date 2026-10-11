// Общие типы, разделяемые сервером и клиентом

export type Rarity = 'white' | 'green' | 'blue' | 'purple' | 'yellow' | 'gold' | 'red';

export const RARITY_ORDER: Rarity[] = ['white', 'green', 'blue', 'purple', 'yellow', 'gold', 'red'];

export const RARITY_LABEL: Record<Rarity, string> = {
  white: 'Белый',
  green: 'Зелёный',
  blue: 'Синий',
  purple: 'Фиолетовый',
  yellow: 'Жёлтый',
  gold: 'Золотой',
  red: 'Красный',
};

export interface ItemDef {
  id: string;
  name: string;
  /** краткое описание предмета (показывается в библиотеке) */
  desc: string;
  rarity: Rarity;
  /** фиксированный номинал предмета (цена продажи торговцу) */
  value: number;
  /** фиксированный размер предмета в клетках: ширина */
  w: number;
  /** фиксированный размер предмета в клетках: высота */
  h: number;
}

/** Экземпляр предмета (в инвентаре, на доске, в лоте) */
export interface ItemInstance {
  id: string;
  defId: string;
  name: string;
  rarity: Rarity;
  value: number;
  w: number;
  h: number;
}

// ---------- Публичное состояние игры ----------

export type GamePhase = 'waiting' | 'ready' | 'auction' | 'finished';
export type AuctionPhase = 'reveal' | 'bid' | 'resolve';

export interface PublicPlayer {
  id: string;
  name: string;
  avatar?: string;
  cash: number;
  startCash: number;
  /** вступительная ставка в банк партии (0 — ещё не поставил) */
  ante: number;
  online: boolean;
  /** пасанул в текущем лоте */
  passed: boolean;
  /** сделана ли ставка в текущем раунде (сумма скрыта до вскрытия) */
  bidPlaced: boolean;
  /** ставка в текущем раунде (видна только после вскрытия) */
  bid?: number;
  /** текущая стоимость инвентаря (предметы не на столе) */
  inventoryValue: number;
  isHost: boolean;
  /** в фазе ожидания: нажал ли игрок «Я готов/а» (актуально только до старта) */
  ready: boolean;
}

export interface PublicCell {
  kind: 'empty' | 'closed' | 'item';
  /** id предмета на клетке (у закрытых клеток тоже есть — для личных подсказок) */
  itemId?: string;
}

export interface PublicLot {
  index: number;
  x: number;
  y: number;
  w: number;
  h: number;
  ownerId?: string;
  open: boolean;
  done: boolean;
  sold?: boolean;
}

export interface PublicBoard {
  w: number;
  h: number;
  cells: PublicCell[];
  lots: PublicLot[];
}

export interface PublicItem {
  id: string;
  board: 'common' | 'prize';
  ownerId?: string;
  lot: number;
  revealed: boolean;
  // поля ниже присутствуют только у раскрытых предметов
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  name?: string;
  rarity?: Rarity;
  value?: number;
}

export interface AuctionBid {
  playerId: string;
  amount: number;
}

export interface AuctionResult {
  winnerId?: string;
  price?: number;
  tie?: boolean;
  voided?: boolean;
  /** компенсация из банка остальным игрокам при переплате (как в NTE) */
  compensation?: number;
}

export interface AuctionPublic {
  board: 'common' | 'prize';
  lotIndex: number;
  ownerId?: string;
  ownerName?: string;
  /** 1..5, 6 = дополнительный раунд при ничьей */
  round: number;
  multiplier: number;
  phase: AuctionPhase;
  totalItems: number;
  revealedCount: number;
  revealedValue: number;
  rarityCounts: Partial<Record<Rarity, number>>;
  bids?: AuctionBid[];
  result?: AuctionResult;
}

export interface LogEntry {
  at: number;
  text: string;
  kind: 'system' | 'reveal' | 'bid' | 'result' | 'chat';
}

export interface FinalStanding {
  playerId: string;
  cash: number;
  inventoryValue: number;
  /** нетто-состояние на финише: наличные + инвентарь */
  total: number;
  place: number;
  /** нетто-состояние на старте: наличные + инвентарь до партии */
  startTotal: number;
  /**
   * Итог партии: total − startTotal. Главная цифра для игрока —
   * вход и ставка здесь уже учтены (наличные на финише их не содержат).
   */
  profit: number;
  /** сколько игрок вложил за партию: вход + оплата выигранных торгов */
  spent: number;
  /** сколько добавилось инвентаря: ценность предметов, полученных за партию */
  inventoryGained: number;
}

/** Личное раскрытие предмета (бонусы сетов — видит только владелец бонуса) */
export interface PrivateReveal {
  itemId: string;
  name: string;
  rarity: Rarity;
  value: number;
  w: number;
  h: number;
}

/** Личная подсказка о редкости скрытого предмета (карточки-анализаторы) */
export interface RarityHint {
  itemId: string;
  rarity: Rarity;
}

/** Персональная информация игрока в партии (рассылается только ему) */
export interface PlayerPrivate {
  reveals: PrivateReveal[];
  hints: string[];
  /** границы скрытых предметов, редкость которых раскрыта лично этому игроку */
  rarityHints: RarityHint[];
}

/** Публичная информация о зале казино (для клиента) */
export interface PublicTier {
  id: string;
  name: string;
  tagline: string;
  entry: number;
  tableMin: number;
  tableMax: number;
  color: string;
  icon: string;
}

export interface PublicGame {
  id: string;
  code: string;
  phase: GamePhase;
  players: PublicPlayer[];
  /** единый игровой стол */
  board: PublicBoard;
  items: PublicItem[];
  auction: AuctionPublic | null;
  /** зал казино: плата за вход и предзаказанная ценность стола */
  tier?: PublicTier;
  /** ценность стола, разыгранная до начала партии */
  tableValue?: number;
  /** серия побед подряд лично у смотрящего (для показа надбавки) */
  myStreak?: number;
  deadline: number;
  log: LogEntry[];
  final?: {
    standings: FinalStanding[];
    winnerId: string;
    /** итоги торгов: по какой цене ушёл стол и сколько было на столе */
    auction?: {
      winnerId: string | null;
      price: number;
      /** ценность стола, разыгранная до партии */
      tableValue: number;
      /** компенсация каждому проигравшему (10% от минуса победителя) */
      perLoserCompensation: number;
      /** стол сгорел из-за двойной ничьей */
      voided: boolean;
    };
  };
  /** присутствует только в персональной рассылке (бонусы сетов) */
  private?: PlayerPrivate;
}

// ---------- Профиль и REST ----------

export interface InventoryRow {
  id: string;
  /** id предмета в каталоге (для сетов убежища) */
  defId: string;
  name: string;
  rarity: Rarity;
  value: number;
  w: number;
  h: number;
  /** позиция в сетке инвентаря (колонок: INV_COLS, строки растут вниз) */
  invX?: number;
  invY?: number;
}

export interface Profile {
  id: string;
  name: string;
  email: string;
  avatar?: string;
  cash: number;
  inventory: InventoryRow[];
  gamesPlayed: number;
  gamesWon: number;
  /** доступ к банку дома (админ-панель) */
  isAdmin: boolean;
  /** аккаунт управляется ботом (ИИ-игроком) */
  isBot?: boolean;
  /** характер бота (только для ботов) */
  botCharacter?: string;
  /** прогресс игрока: ранг, накопленный итог, серии */
  progress?: PlayerProgress;
  /** текущая серия побед подряд (дублируется для быстрого доступа) */
  currentStreak?: number;
  /** накопленный итог партий за карьеру (дублируется для быстрого доступа) */
  totalWinnings?: number;
}

/** Прогресс игрока: то, ради чего копят и рискуют */
export interface PlayerProgress {
  /** идентификатор ранга */
  rankId: string;
  rankName: string;
  rankColor: string;
  rankIcon: string;
  /** накопленный итог партий за карьеру */
  totalWinnings: number;
  /** лучшая серия побед подряд */
  bestStreak: number;
  /** текущая серия побед подряд */
  currentStreak: number;
  /** следующий ранг и сколько до него осталось */
  next: { name: string; minWinnings: number; remaining: number } | null;
  /** доля пути до следующего ранга, 0..1 (для полосы прогресса) */
  progress: number;
  /** какие залы доступны по рангу */
  unlockedTiers: string[];
}

export interface RoomInfo {
  code: string;
  players: number;
  hostName: string;
}

/** Одна партия в истории матчей игрока */
export interface MatchHistoryEntry {
  gameId: string;
  /** код комнаты */
  code: string;
  /** время завершения партии, мс */
  finishedAt: number;
  winnerId: string;
  /** занятое место */
  place: number;
  /** сколько игроков участвовало */
  players: number;
  /** сумма вложений в партию: вступительная ставка + оплата выигранных торгов */
  invested: number;
  /** разница состояния за партию: плюс — ушёл в плюс, минус — ушёл в минус */
  profit: number;
}

/** Участник партии в детализации матча (история матчей) */
export interface GameDetailPlayer {
  id: string;
  name: string;
  place: number;
}

/** Предмет призового стола партии (история матчей) */
export interface GamePrizeItem {
  itemId: string;
  defId: string;
  name: string;
  rarity: Rarity;
  value: number;
  w: number;
  h: number;
  /** кто получил предмет; undefined — сгорел (аукцион без продажи) */
  ownerId?: string;
}

/** Детализация матча для модалки истории: участники и предметы стола */
export interface GameDetail {
  gameId: string;
  code: string;
  finishedAt: number;
  winnerId: string;
  players: GameDetailPlayer[];
  items: GamePrizeItem[];
}

/** Строка таблицы лидеров */
export interface LeaderboardEntry {
  /** место в списке (начинается с 1) */
  rank: number;
  id: string;
  name: string;
  avatar?: string;
  cash: number;
  /** суммарный номинал всех предметов игрока */
  inventoryValue: number;
  /** наличные + номинал инвентаря — «счёт», по которому строится топ */
  netWorth: number;
  gamesWon: number;
  /** аккаунт управляется ботом (ИИ-игроком) */
  isBot?: boolean;
}

/** Ответ таблицы лидеров: страница топа + место текущего игрока */
export interface LeaderboardResponse {
  entries: LeaderboardEntry[];
  me: LeaderboardEntry | null;
  /** всего игроков в таблице */
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  /** сколько всего игроков-людей (без ботов) */
  humansTotal?: number;
  /** сколько всего ботов */
  botsTotal?: number;
}

/** Публичная страница профиля игрока (видна любому авторизованному) */
export interface PublicProfile {
  id: string;
  name: string;
  avatar?: string;
  isAdmin: boolean;
  /** аккаунт управляется ботом (ИИ-игроком) */
  isBot?: boolean;
  /** дата регистрации, мс */
  createdAt: number;
  gamesPlayed: number;
  gamesWon: number;
  /** всего предметов в собственности (включая занятые партией, барахолкой и витринами) */
  itemsCount: number;
  /** суммарный номинал всех предметов игрока */
  inventoryValue: number;
  /** собранные сеты / всего сетов */
  completedSets: number;
  totalSets: number;
  /** наличные + номинал инвентаря */
  netWorth: number;
}

// ---------- События Socket.IO ----------

export const C2S = {
  createRoom: 'room:create',
  joinRoom: 'room:join',
  leaveRoom: 'room:leave',
  start: 'room:start',
  /** быстрый подбор: в ближайшую свободную комнату или создание новой */
  play: 'room:play',
  /** переключение «Я готов/а» в комнате ожидания */
  ready: 'room:ready',
  ante: 'game:ante',
  bid: 'game:bid',
  /** применить особую карточку (анализатор редкости) во время партии */
  useCard: 'card:use',
  sync: 'game:sync',
  /** короткая реплика в лог партии */
  say: 'game:say',
} as const;

export const S2C = {
  state: 'state',
  toast: 'toast',
  error: 'error',
} as const;
