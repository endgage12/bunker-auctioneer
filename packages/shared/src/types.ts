// Общие типы, разделяемые сервером и клиентом

export type Rarity = 'white' | 'green' | 'blue' | 'purple' | 'gold' | 'red';

export const RARITY_ORDER: Rarity[] = ['white', 'green', 'blue', 'purple', 'gold', 'red'];

export const RARITY_LABEL: Record<Rarity, string> = {
  white: 'Белый',
  green: 'Зелёный',
  blue: 'Синий',
  purple: 'Фиолетовый',
  gold: 'Золотой',
  red: 'Красный',
};

export interface ItemDef {
  id: string;
  name: string;
  /** краткое описание предмета (показывается в библиотеке) */
  desc: string;
  rarity: Rarity;
  minValue: number;
  maxValue: number;
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

export type GamePhase = 'waiting' | 'betting' | 'auction' | 'finished';
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
}

export interface PublicCell {
  kind: 'empty' | 'closed' | 'item';
  /** id предмета, если kind === 'item' */
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
  kind: 'system' | 'reveal' | 'bid' | 'result';
}

export interface FinalStanding {
  playerId: string;
  cash: number;
  inventoryValue: number;
  total: number;
  place: number;
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

/** Персональная информация игрока в партии (рассылается только ему) */
export interface PlayerPrivate {
  reveals: PrivateReveal[];
  hints: string[];
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
  deadline: number;
  log: LogEntry[];
  final?: { standings: FinalStanding[]; winnerId: string };
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
}

export interface RoomInfo {
  code: string;
  players: number;
  hostName: string;
}

// ---------- События Socket.IO ----------

export const C2S = {
  createRoom: 'room:create',
  joinRoom: 'room:join',
  leaveRoom: 'room:leave',
  start: 'room:start',
  ante: 'game:ante',
  bid: 'game:bid',
  sync: 'game:sync',
} as const;

export const S2C = {
  state: 'state',
  toast: 'toast',
  error: 'error',
} as const;
