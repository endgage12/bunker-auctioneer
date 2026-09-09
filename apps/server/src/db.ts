// SQLite-хранилище (node:sqlite) — пользователи, предметы, история игр
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from './config';
import { generateStarterPack, mulberry32, START_CASH } from '@auctioneer/shared';
import { generateSantaReward, INV_COLS, INV_ROWS, ITEM_CATALOG, MARKET_LISTING_TTL_MS, SANTA_COLS, SANTA_MIN_ITEMS, SANTA_ROWS, SETS, marketFee, santaRewardCount, santaTimerMs } from '@auctioneer/shared';
import { CARD_DEFS, RARITY_LABEL, RARITY_ORDER, WHEEL_TICKET_DEF_ID, WHEEL_TICKET_NAME, findCard, pickCardByWeight } from '@auctioneer/shared';
import type {
  AdminBank,
  BankTx,
  BankTxPage,
  GameDetail,
  HideoutState,
  InventoryRow,
  ItemInstance,
  LeaderboardEntry,
  LeaderboardResponse,
  MarketHistoryEntry,
  MatchHistoryEntry,
  MarketListing,
  Profile,
  PublicProfile,
  Rarity,
  SantaBoxItem,
  SantaState,
  SetProgress,
} from '@auctioneer/shared';
import type { FinalReport } from './game/engine';

/** Внутренний аккаунт дома (банка) */
export const HOUSE_ID = 'house';

export interface UserRow {
  id: string;
  googleId: string | null;
  email: string;
  name: string;
  avatar: string | null;
  cash: number;
  gamesPlayed: number;
  gamesWon: number;
  isAdmin: boolean;
  lastTransmuteAt: number;
  createdAt: number;
}

if (!existsSync(dirname(config.dbPath))) mkdirSync(dirname(config.dbPath), { recursive: true });
const db = new DatabaseSync(config.dbPath);

const SCHEMA = [
  'PRAGMA journal_mode = WAL;',
  'CREATE TABLE IF NOT EXISTS users (',
  '  id TEXT PRIMARY KEY,',
  '  google_id TEXT UNIQUE,',
  '  email TEXT NOT NULL,',
  '  name TEXT NOT NULL,',
  '  avatar TEXT,',
  '  cash INTEGER NOT NULL DEFAULT 0,',
  '  games_played INTEGER NOT NULL DEFAULT 0,',
  '  games_won INTEGER NOT NULL DEFAULT 0,',
  '  is_admin INTEGER NOT NULL DEFAULT 0,',
  '  created_at INTEGER NOT NULL',
  ');',
  'CREATE TABLE IF NOT EXISTS items (',
  '  id TEXT PRIMARY KEY,',
  '  user_id TEXT NOT NULL,',
  '  def_id TEXT NOT NULL,',
  '  name TEXT NOT NULL,',
  '  rarity TEXT NOT NULL,',
  '  value INTEGER NOT NULL,',
  '  w INTEGER NOT NULL,',
  '  h INTEGER NOT NULL,',
  '  game_id TEXT,',
  '  inv_x INTEGER,',
  '  inv_y INTEGER,',
  '  created_at INTEGER NOT NULL',
  ');',
  'CREATE TABLE IF NOT EXISTS games (',
  '  id TEXT PRIMARY KEY,',
  '  code TEXT NOT NULL,',
  '  winner_id TEXT,',
  '  finished_at INTEGER NOT NULL',
  ');',
  'CREATE TABLE IF NOT EXISTS game_players (',
  '  game_id TEXT NOT NULL,',
  '  user_id TEXT NOT NULL,',
  '  start_cash INTEGER NOT NULL,',
  '  end_cash INTEGER NOT NULL,',
  '  place INTEGER NOT NULL,',
  '  invested INTEGER NOT NULL DEFAULT 0,',
  '  profit INTEGER NOT NULL DEFAULT 0',
  ');',
  'CREATE TABLE IF NOT EXISTS game_items (',
  '  game_id TEXT NOT NULL,',
  '  item_id TEXT,',
  '  def_id TEXT NOT NULL,',
  '  name TEXT NOT NULL,',
  '  rarity TEXT NOT NULL,',
  '  value INTEGER NOT NULL,',
  '  w INTEGER NOT NULL,',
  '  h INTEGER NOT NULL,',
  '  owner_id TEXT',
  ');',
  'CREATE TABLE IF NOT EXISTS market_listings (',
  '  id TEXT PRIMARY KEY,',
  '  item_id TEXT NOT NULL UNIQUE,',
  '  seller_id TEXT NOT NULL,',
  '  price INTEGER NOT NULL,',
  '  created_at INTEGER NOT NULL,',
  '  expires_at INTEGER NOT NULL',
  ');',
  'CREATE TABLE IF NOT EXISTS showcase_items (',
  '  item_id TEXT PRIMARY KEY,',
  '  user_id TEXT NOT NULL,',
  '  set_id TEXT NOT NULL,',
  '  placed_at INTEGER NOT NULL',
  ');',
  'CREATE TABLE IF NOT EXISTS santa_items (',
  '  id TEXT PRIMARY KEY,',
  '  user_id TEXT NOT NULL,',
  '  def_id TEXT NOT NULL,',
  '  name TEXT NOT NULL,',
  '  rarity TEXT NOT NULL,',
  '  value INTEGER NOT NULL,',
  '  w INTEGER NOT NULL,',
  '  h INTEGER NOT NULL,',
  '  kind TEXT NOT NULL,',
  '  pending INTEGER NOT NULL DEFAULT 0,',
  '  x INTEGER,',
  '  y INTEGER,',
  '  created_at INTEGER NOT NULL',
  ');',
  'CREATE TABLE IF NOT EXISTS santa_cycles (',
  '  id TEXT PRIMARY KEY,',
  '  user_id TEXT NOT NULL,',
  '  completed_at INTEGER NOT NULL,',
  '  items_in INTEGER NOT NULL,',
  '  value_in INTEGER NOT NULL,',
  '  items_out INTEGER NOT NULL,',
  '  value_out INTEGER NOT NULL',
  ');',
  'CREATE TABLE IF NOT EXISTS cards (',
  '  id TEXT PRIMARY KEY,',
  '  user_id TEXT NOT NULL,',
  '  card_id TEXT NOT NULL,',
  '  created_at INTEGER NOT NULL',
  ');',
  'CREATE TABLE IF NOT EXISTS bank_transactions (',
  '  id TEXT PRIMARY KEY,',
  '  at INTEGER NOT NULL,',
  '  type TEXT NOT NULL,',
  '  amount INTEGER NOT NULL,',
  '  balance_after INTEGER NOT NULL,',
  '  party_user_id TEXT,',
  '  note TEXT',
  ');',
  'CREATE TABLE IF NOT EXISTS market_history (',
  '  id TEXT PRIMARY KEY,',
  '  at INTEGER NOT NULL,',
  '  user_id TEXT NOT NULL,',
  '  kind TEXT NOT NULL,',
  '  item_name TEXT NOT NULL,',
  '  rarity TEXT NOT NULL,',
  '  price INTEGER NOT NULL,',
  '  fee INTEGER NOT NULL DEFAULT 0,',
  '  counterpart TEXT',
  ');',
  'CREATE INDEX IF NOT EXISTS idx_items_user ON items(user_id);',
  'CREATE INDEX IF NOT EXISTS idx_game_players_user ON game_players(user_id);',
  'CREATE INDEX IF NOT EXISTS idx_game_items_game ON game_items(game_id);',
  'CREATE INDEX IF NOT EXISTS idx_market_history_user ON market_history(user_id);',
  'CREATE INDEX IF NOT EXISTS idx_santa_items_user ON santa_items(user_id);',
  'CREATE INDEX IF NOT EXISTS idx_santa_cycles_user ON santa_cycles(user_id);',
  'CREATE INDEX IF NOT EXISTS idx_cards_user ON cards(user_id);',
].join('\n');

db.exec(SCHEMA);

// Миграция старых БД: колонка is_admin
{
  const cols = db.prepare("SELECT name FROM pragma_table_info('users')").all() as unknown as Row[];
  if (!cols.some((c) => c.name === 'is_admin')) {
    db.exec('ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0');
  }
  if (!cols.some((c) => c.name === 'last_transmute_at')) {
    db.exec('ALTER TABLE users ADD COLUMN last_transmute_at INTEGER');
  }
  const itemCols = db.prepare("SELECT name FROM pragma_table_info('items')").all() as unknown as Row[];
  if (!itemCols.some((c) => c.name === 'inv_x')) {
    db.exec('ALTER TABLE items ADD COLUMN inv_x INTEGER');
  }
  if (!itemCols.some((c) => c.name === 'inv_y')) {
    db.exec('ALTER TABLE items ADD COLUMN inv_y INTEGER');
  }
  const gpCols = db.prepare("SELECT name FROM pragma_table_info('game_players')").all() as unknown as Row[];
  if (!gpCols.some((c) => c.name === 'invested')) {
    db.exec('ALTER TABLE game_players ADD COLUMN invested INTEGER NOT NULL DEFAULT 0');
  }
  if (!gpCols.some((c) => c.name === 'profit')) {
    db.exec('ALTER TABLE game_players ADD COLUMN profit INTEGER NOT NULL DEFAULT 0');
  }
}

// Если сервер был перезапущен во время игры — возвращаем «зависшие» предметы владельцам
db.exec('UPDATE items SET game_id = NULL WHERE game_id IS NOT NULL');
// Убираем истёкшие лоты барахолки (предметы автоматически возвращаются в инвентарь)
db.prepare('DELETE FROM market_listings WHERE expires_at < ?').run(Date.now());
// Аккаунт дома (банка)
ensureHouse();
// Позиции предметов в сетке инвентаря для старых записей
migrateInventoryPositions();

type Row = Record<string, unknown>;

function mapUser(r: Row | undefined): UserRow | null {
  if (!r) return null;
  return {
    id: String(r.id),
    googleId: r.google_id == null ? null : String(r.google_id),
    email: String(r.email),
    name: String(r.name),
    avatar: r.avatar == null ? null : String(r.avatar),
    cash: Number(r.cash),
    gamesPlayed: Number(r.games_played),
    gamesWon: Number(r.games_won),
    isAdmin: Number(r.is_admin) === 1,
    lastTransmuteAt: Number(r.last_transmute_at ?? 0),
    createdAt: Number(r.created_at),
  };
}

/** Число «Пыльных ваз» (билетов колеса фортуны) сверх стартового набора */
const STARTER_WHEEL_TICKETS = 5;

function createStarterPack(userId: string): ItemInstance[] {
  let seed = Date.now() & 0xffffffff;
  for (const ch of userId) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const pack = generateStarterPack(mulberry32(seed));
  // Сверху новичок получает билеты колеса фортуны — «Пыльные вазы»
  const ticket = ITEM_CATALOG.find((d) => d.id === WHEEL_TICKET_DEF_ID);
  if (ticket) {
    for (let i = 0; i < STARTER_WHEEL_TICKETS; i++) {
      pack.push({
        id: crypto.randomUUID(),
        defId: ticket.id,
        name: ticket.name,
        rarity: ticket.rarity,
        value: ticket.value,
        w: ticket.w,
        h: ticket.h,
      });
    }
  }
  const now = Date.now();
  const insert = db.prepare(
    'INSERT INTO items (id, user_id, def_id, name, rarity, value, w, h, game_id, inv_x, inv_y, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)',
  );
  for (const it of pack) {
    const slot = findFreeSlot(userId, it.w, it.h);
    insert.run(it.id, userId, it.defId, it.name, it.rarity, it.value, it.w, it.h, slot ? slot.x : null, slot ? slot.y : null, now);
  }
  db.prepare('UPDATE users SET cash = ? WHERE id = ?').run(START_CASH, userId);
  houseAdjust(-START_CASH, 'starter', userId, 'Стартовый капитал игрока');
  return pack;
}

function syncAdminFlag(id: string, email: string): void {
  const isAdmin = config.adminEmails.includes(email.toLowerCase()) ? 1 : 0;
  db.prepare('UPDATE users SET is_admin = ? WHERE id = ?').run(isAdmin, id);
}

function insertUser(googleId: string | null, email: string, name: string, avatar: string | null): UserRow {
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO users (id, google_id, email, name, avatar, cash, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)')
    .run(id, googleId, email, name, avatar, Date.now());
  createStarterPack(id);
  syncAdminFlag(id, email);
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as Row | undefined;
  return mapUser(row)!;
}

export function upsertGoogleUser(info: { googleId: string; email: string; name: string; avatar?: string }): UserRow {
  const existing = db.prepare('SELECT * FROM users WHERE google_id = ?').get(info.googleId) as Row | undefined;
  if (existing) {
    db.prepare('UPDATE users SET email = ?, name = ?, avatar = ? WHERE id = ?')
      .run(info.email, info.name, info.avatar ?? null, String(existing.id));
    syncAdminFlag(String(existing.id), info.email);
    return mapUser(db.prepare('SELECT * FROM users WHERE id = ?').get(String(existing.id)) as Row | undefined)!;
  }
  return insertUser(info.googleId, info.email, info.name, info.avatar ?? null);
}

export function findOrCreateDevUser(email: string, name: string): UserRow {
  const existing = db.prepare('SELECT * FROM users WHERE email = ? AND google_id IS NULL').get(email) as Row | undefined;
  if (existing) {
    db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, String(existing.id));
    syncAdminFlag(String(existing.id), email);
    return mapUser(db.prepare('SELECT * FROM users WHERE id = ?').get(String(existing.id)) as Row | undefined)!;
  }
  return insertUser(null, email, name, null);
}

/** Служебный аккаунт администратора банка дома для кнопки «Войти (admin)» */
export function findOrCreateAdminUser(): UserRow {
  const email = 'admin@auctioneer.local';
  const existing = db.prepare('SELECT * FROM users WHERE email = ? AND google_id IS NULL').get(email) as Row | undefined;
  const id = existing ? String(existing.id) : insertUser(null, email, 'Администратор', null).id;
  // Права админа выдаются принудительно, независимо от ADMIN_EMAILS
  db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(id);
  return mapUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id) as Row | undefined)!;
}

export function getUserById(id: string): UserRow | null {
  return mapUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id) as Row | undefined);
}

function listInventory(userId: string): InventoryRow[] {
  const rows = db.prepare(
    'SELECT id, def_id, name, rarity, value, w, h, inv_x, inv_y FROM items WHERE user_id = ? AND game_id IS NULL AND id NOT IN (SELECT item_id FROM market_listings) AND id NOT IN (SELECT item_id FROM showcase_items) ORDER BY value DESC',
  ).all(userId) as unknown as Row[];
  return rows.map((r) => ({
    id: String(r.id),
    defId: String(r.def_id),
    name: String(r.name),
    rarity: String(r.rarity) as Rarity,
    value: Number(r.value),
    w: Number(r.w),
    h: Number(r.h),
    invX: r.inv_x == null ? undefined : Number(r.inv_x),
    invY: r.inv_y == null ? undefined : Number(r.inv_y),
  }));
}

export function getProfile(userId: string): Profile | null {
  const u = getUserById(userId);
  if (!u) return null;
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    avatar: u.avatar ?? undefined,
    cash: u.cash,
    inventory: listInventory(userId),
    gamesPlayed: u.gamesPlayed,
    gamesWon: u.gamesWon,
    isAdmin: u.isAdmin,
  };
}

/** Публичный профиль игрока для страницы /profile/:id */
export function getPublicProfile(userId: string): PublicProfile | null {
  const u = getUserById(userId);
  if (!u || u.id === HOUSE_ID) return null;
  const items = db
    .prepare('SELECT COALESCE(SUM(value), 0) AS v, COUNT(*) AS c FROM items WHERE user_id = ?')
    .get(userId) as Row | undefined;
  const hideout = getHideout(userId);
  const inventoryValue = Number(items?.v ?? 0);
  return {
    id: u.id,
    name: u.name,
    avatar: u.avatar ?? undefined,
    isAdmin: u.isAdmin,
    createdAt: u.createdAt,
    gamesPlayed: u.gamesPlayed,
    gamesWon: u.gamesWon,
    itemsCount: Number(items?.c ?? 0),
    inventoryValue,
    completedSets: hideout.completedSets,
    totalSets: hideout.totalSets,
    netWorth: u.cash + inventoryValue,
  };
}

/** Таблица лидеров: топ игроков по «счёту» (наличные + номинал инвентаря) */
export function getLeaderboard(limit: number, selfId: string): LeaderboardResponse {
  const rows = db
    .prepare(
      'SELECT u.id, u.name, u.avatar, u.cash, u.games_won AS gamesWon, ' +
        'COALESCE((SELECT SUM(i.value) FROM items i WHERE i.user_id = u.id), 0) AS invValue ' +
        'FROM users u WHERE u.id != ? ' +
        'ORDER BY (u.cash + COALESCE((SELECT SUM(i.value) FROM items i WHERE i.user_id = u.id), 0)) DESC, u.created_at ASC',
    )
    .all(HOUSE_ID) as Row[];
  const all: LeaderboardEntry[] = rows.map((r, idx) => ({
    rank: idx + 1,
    id: String(r.id),
    name: String(r.name),
    avatar: r.avatar ? String(r.avatar) : undefined,
    cash: Number(r.cash),
    inventoryValue: Number(r.invValue),
    netWorth: Number(r.cash) + Number(r.invValue),
    gamesWon: Number(r.gamesWon ?? 0),
  }));
  return {
    entries: all.slice(0, Math.max(1, Math.floor(limit))),
    me: selfId ? all.find((e) => e.id === selfId) ?? null : null,
  };
}

/** История матчей игрока: вложения и разница (плюс/минус) по каждой партии */
export function getMatchHistory(userId: string, limit = 50): MatchHistoryEntry[] {
  const rows = db
    .prepare(
      'SELECT g.id AS game_id, g.code, g.finished_at, g.winner_id, gp.place, gp.invested, gp.profit, ' +
        '(SELECT COUNT(*) FROM game_players gp2 WHERE gp2.game_id = g.id) AS players ' +
        'FROM game_players gp JOIN games g ON g.id = gp.game_id ' +
        'WHERE gp.user_id = ? ORDER BY g.finished_at DESC, g.rowid DESC LIMIT ?',
    )
    .all(userId, limit) as unknown as Row[];
  return rows.map((r) => ({
    gameId: String(r.game_id),
    code: String(r.code),
    finishedAt: Number(r.finished_at),
    winnerId: String(r.winner_id ?? ''),
    place: Number(r.place),
    players: Number(r.players ?? 0),
    invested: Number(r.invested ?? 0),
    profit: Number(r.profit ?? 0),
  }));
}

/** Детализация матча для истории: участники и предметы призового стола */
export function getGameDetail(gameId: string): GameDetail | null {
  const game = db.prepare('SELECT id, code, winner_id, finished_at FROM games WHERE id = ?').get(gameId) as Row | undefined;
  if (!game) return null;
  const playerRows = db
    .prepare(
      'SELECT u.id AS id, u.name AS name, gp.place AS place FROM game_players gp JOIN users u ON u.id = gp.user_id WHERE gp.game_id = ? ORDER BY gp.place ASC',
    )
    .all(gameId) as unknown as Row[];
  const itemRows = db
    .prepare('SELECT * FROM game_items WHERE game_id = ? ORDER BY value DESC, rowid ASC')
    .all(gameId) as unknown as Row[];
  return {
    gameId: String(game.id),
    code: String(game.code),
    finishedAt: Number(game.finished_at),
    winnerId: String(game.winner_id ?? ''),
    players: playerRows.map((r) => ({
      id: String(r.id),
      name: String(r.name),
      place: Number(r.place),
    })),
    items: itemRows.map((r) => ({
      itemId: r.item_id == null ? '' : String(r.item_id),
      defId: String(r.def_id),
      name: String(r.name),
      rarity: String(r.rarity) as GameDetail['items'][number]['rarity'],
      value: Number(r.value),
      w: Number(r.w),
      h: Number(r.h),
      ownerId: r.owner_id == null ? undefined : String(r.owner_id),
    })),
  };
}

/** Пометить предметы как занятые игрой (защита от использования в двух комнатах) */
export function markItemsInGame(ids: string[], gameId: string): void {
  const stmt = db.prepare('UPDATE items SET game_id = ? WHERE id = ?');
  for (const id of ids) stmt.run(gameId, id);
}

// ---------- Барахолка и торговец ----------

export interface MarketOpResult {
  ok: boolean;
  error?: string;
  price?: number;
  fee?: number;
  value?: number;
  item?: ItemInstance;
}

function expireMarketListings(): void {
  db.prepare('DELETE FROM market_listings WHERE expires_at < ?').run(Date.now());
}

/** Записать операцию в историю барахолки игрока */
function recordMarketHistory(
  userId: string,
  kind: 'buy' | 'sell' | 'vendor',
  item: Row,
  price: number,
  fee: number,
  counterpart: string,
): void {
  db.prepare(
    'INSERT INTO market_history (id, at, user_id, kind, item_name, rarity, price, fee, counterpart) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(crypto.randomUUID(), Date.now(), userId, kind, String(item.name), String(item.rarity), price, fee, counterpart);
}

/** История операций игрока на барахолке (последние limit) */
export function getMarketHistory(userId: string, limit = 50): MarketHistoryEntry[] {
  const rows = db
    .prepare('SELECT * FROM market_history WHERE user_id = ? ORDER BY at DESC LIMIT ?')
    .all(userId, limit) as unknown as Row[];
  return rows.map((r) => ({
    id: String(r.id),
    at: Number(r.at),
    kind: String(r.kind) as MarketHistoryEntry['kind'],
    itemName: String(r.item_name),
    rarity: String(r.rarity) as Rarity,
    price: Number(r.price),
    fee: Number(r.fee ?? 0),
    counterpart: String(r.counterpart ?? ''),
  }));
}

/** Выставить предмет на барахолку по своей цене */
export function createListing(sellerId: string, itemId: string, price: number): MarketOpResult {
  expireMarketListings();
  const item = db
    .prepare('SELECT * FROM items WHERE id = ? AND user_id = ? AND game_id IS NULL')
    .get(itemId, sellerId) as Row | undefined;
  if (!item) return { ok: false, error: 'Предмет недоступен для продажи' };
  const listed = db.prepare('SELECT 1 AS e FROM market_listings WHERE item_id = ?').get(itemId);
  if (listed) return { ok: false, error: 'Предмет уже выставлен на барахолке' };
  price = Math.floor(price);
  if (!Number.isFinite(price) || price < 1) return { ok: false, error: 'Укажите цену больше нуля' };
  // сет «Призрак рынка»: лоты живут на 2 дня дольше
  const bonuses = getActiveSetBonuses(sellerId);
  const ttl = MARKET_LISTING_TTL_MS + (bonuses.includes('listing_ttl_bonus') ? 2 * 24 * 60 * 60 * 1000 : 0);
  db.prepare(
    'INSERT INTO market_listings (id, item_id, seller_id, price, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(crypto.randomUUID(), itemId, sellerId, price, Date.now(), Date.now() + ttl);
  return { ok: true };
}

/** Все активные лоты барахолки (с флагом mine для текущего пользователя) */
export function getMarketListings(viewerId: string): MarketListing[] {
  expireMarketListings();
  const rows = db.prepare(
    'SELECT m.id AS listing_id, m.seller_id, m.price, m.created_at, m.expires_at, i.id AS item_id, i.def_id, i.name, i.rarity, i.value, i.w, i.h, u.name AS seller_name FROM market_listings m JOIN items i ON i.id = m.item_id JOIN users u ON u.id = m.seller_id ORDER BY m.price ASC, m.created_at ASC',
  ).all() as unknown as Row[];
  return rows.map((r) => ({
    id: String(r.listing_id),
    item: {
      id: String(r.item_id),
      defId: String(r.def_id),
      name: String(r.name),
      rarity: String(r.rarity) as Rarity,
      value: Number(r.value),
      w: Number(r.w),
      h: Number(r.h),
    },
    sellerId: String(r.seller_id),
    sellerName: String(r.seller_name),
    price: Number(r.price),
    createdAt: Number(r.created_at),
    expiresAt: Number(r.expires_at),
    mine: String(r.seller_id) === viewerId,
  }));
}

/** Купить лот: деньги покупателя -> продавцу (минус комиссия дома), предмет -> покупателю */
export function buyListing(buyerId: string, listingId: string): MarketOpResult {
  expireMarketListings();
  const row = db.prepare('SELECT m.item_id, m.seller_id, m.price, i.w, i.h FROM market_listings m JOIN items i ON i.id = m.item_id WHERE m.id = ?').get(listingId) as Row | undefined;
  if (!row) return { ok: false, error: 'Лот не найден или истёк' };
  const sellerId = String(row.seller_id);
  if (sellerId === buyerId) return { ok: false, error: 'Нельзя купить собственный лот' };
  const price = Number(row.price);
  const buyer = getUserById(buyerId);
  if (!buyer) return { ok: false, error: 'Покупатель не найден' };
  if (buyer.cash < price) return { ok: false, error: 'Недостаточно средств' };
  // сет «Призрак рынка»: комиссия покупателя −2 п.п. (минимум 3%)
  const buyerBonuses = getActiveSetBonuses(buyerId);
  const feePct = buyerBonuses.includes('market_fee_discount') ? 3 : 5;
  const fee = Math.floor((price * feePct) / 100);
  db.exec('BEGIN');
  try {
    db.prepare('UPDATE users SET cash = cash - ? WHERE id = ?').run(price, buyerId);
    if (sellerId === HOUSE_ID) {
      houseAdjust(price - fee, 'market_sale', buyerId, 'Продажа предмета дома на барахолке');
    } else {
      db.prepare('UPDATE users SET cash = cash + ? WHERE id = ?').run(price - fee, sellerId);
    }
    houseAdjust(fee, 'market_fee', buyerId, 'Комиссия барахолки');
    const slot = findFreeSlot(buyerId, Number(row.w), Number(row.h));
    if (!slot) return { ok: false, error: 'Нет места в инвентаре — освободите сетку' };
    db.prepare('UPDATE items SET user_id = ?, inv_x = ?, inv_y = ? WHERE id = ?').run(buyerId, slot.x, slot.y, String(row.item_id));
    db.prepare('DELETE FROM market_listings WHERE id = ?').run(listingId);
    const sold = db.prepare('SELECT name, rarity, value FROM items WHERE id = ?').get(String(row.item_id)) as Row | undefined;
    if (sold) {
      const buyerName = getUserById(buyerId)?.name ?? 'Игрок';
      const sellerName = getUserById(sellerId)?.name ?? 'Игрок';
      if (buyerId !== HOUSE_ID) recordMarketHistory(buyerId, 'buy', sold, price, 0, sellerName);
      if (sellerId !== HOUSE_ID) recordMarketHistory(sellerId, 'sell', sold, price, fee, buyerName);
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return { ok: true, price, fee };
}

/** Снять собственный лот (предмет возвращается в инвентарь) */
export function cancelListing(userId: string, listingId: string): MarketOpResult {
  expireMarketListings();
  const row = db.prepare('SELECT item_id FROM market_listings WHERE id = ? AND seller_id = ?').get(listingId, userId) as Row | undefined;
  if (!row) return { ok: false, error: 'Лот не найден' };
  db.prepare('DELETE FROM market_listings WHERE id = ?').run(listingId);
  const item = db.prepare('SELECT w, h FROM items WHERE id = ?').get(String(row.item_id)) as Row | undefined;
  if (item) {
    const slot = findFreeSlot(userId, Number(item.w), Number(item.h));
    if (slot) db.prepare('UPDATE items SET inv_x = ?, inv_y = ? WHERE id = ?').run(slot.x, slot.y, String(row.item_id));
  }
  return { ok: true };
}

/** Мгновенная продажа торговцу по номиналу предмета */
export function sellToVendor(userId: string, itemId: string): MarketOpResult {
  const item = db
    .prepare('SELECT * FROM items WHERE id = ? AND user_id = ? AND game_id IS NULL')
    .get(itemId, userId) as Row | undefined;
  if (!item) return { ok: false, error: 'Предмет недоступен для продажи' };
  const listed = db.prepare('SELECT 1 AS e FROM market_listings WHERE item_id = ?').get(itemId);
  if (listed) return { ok: false, error: 'Сначала снимите предмет с барахолки' };
  const value = Number(item.value);
  // сет «Тёплый очаг»: торговец покупает на 5% дороже номинала
  const bonuses = getActiveSetBonuses(userId);
  const sellValue = bonuses.includes('trader_bonus') ? Math.round(value * 1.05) : value;
  db.exec('BEGIN');
  try {
    // предмет переходит в собственность дома, дом платит номинал
    db.prepare('UPDATE items SET user_id = ?, inv_x = NULL, inv_y = NULL WHERE id = ?').run(HOUSE_ID, itemId);
    db.prepare('UPDATE users SET cash = cash + ? WHERE id = ?').run(sellValue, userId);
    houseAdjust(-sellValue, 'vendor', userId, 'Покупка предмета у игрока');
    recordMarketHistory(userId, 'vendor', item, sellValue, 0, 'Торговец');
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return { ok: true, value: sellValue };
}

/** Применить итоги завершённой игры: деньги, владение предметами, статистика */
export function finalizeGame(report: FinalReport): void {
  const now = Date.now();
  db.exec('BEGIN');
  try {
    const updCash = db.prepare('UPDATE users SET cash = ? WHERE id = ?');
    const updItem = db.prepare('UPDATE items SET user_id = ?, game_id = NULL, inv_x = ?, inv_y = ? WHERE id = ?');
    const insItem = db.prepare(
      'INSERT INTO items (id, user_id, def_id, name, rarity, value, w, h, game_id, inv_x, inv_y, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)',
    );
    const chk = db.prepare('SELECT 1 AS e FROM items WHERE id = ?');
    for (const [pid, cash] of Object.entries(report.cash)) updCash.run(cash, pid);
    for (const [pid, items] of Object.entries(report.inventories)) {
      for (const it of items) {
        const slot = findFreeSlot(pid, it.w, it.h);
        if (chk.get(it.id)) updItem.run(pid, slot ? slot.x : null, slot ? slot.y : null, it.id);
        else insItem.run(it.id, pid, it.defId, it.name, it.rarity, it.value, it.w, it.h, slot ? slot.x : null, slot ? slot.y : null, now);
      }
    }
    for (const it of report.droppedItems) db.prepare('DELETE FROM items WHERE id = ?').run(it.id);
    db.prepare('INSERT INTO games (id, code, winner_id, finished_at) VALUES (?, ?, ?, ?)')
      .run(report.gameId, report.code, report.winnerId, now);
    const insGP = db.prepare(
      'INSERT INTO game_players (game_id, user_id, start_cash, end_cash, place, invested, profit) VALUES (?, ?, ?, ?, ?, ?, ?)',
    );
    for (const s of report.standings) {
      insGP.run(
        report.gameId,
        s.playerId,
        report.startCash[s.playerId] ?? 0,
        s.cash,
        s.place,
        report.invested[s.playerId] ?? 0,
        report.profit[s.playerId] ?? 0,
      );
    }
    const insGI = db.prepare(
      'INSERT INTO game_items (game_id, item_id, def_id, name, rarity, value, w, h, owner_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    for (const it of report.prizeItems) {
      insGI.run(report.gameId, it.id, it.defId, it.name, it.rarity, it.value, it.w, it.h, it.ownerId ?? null);
    }
    db.prepare('UPDATE users SET games_played = games_played + 1 WHERE id IN (SELECT user_id FROM game_players WHERE game_id = ?)').run(report.gameId);
    db.prepare('UPDATE users SET games_won = games_won + 1 WHERE id = ?').run(report.winnerId);
    if (report.antePot > 0) {
      houseAdjust(report.antePot, 'ante', null, 'Вступительные ставки партии ' + report.code);
    }
    if (report.moneyToBank > 0) {
      houseAdjust(report.moneyToBank, 'game', null, 'Доход от партии ' + report.code);
    }
    // страховка: освобождаем любые предметы, всё ещё помеченные этой игрой
    db.prepare('UPDATE items SET game_id = NULL WHERE game_id = ?').run(report.gameId);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

// ---------- Банк дома и админ ----------

/** Проводка по банку дома с записью в журнал операций */
function houseAdjust(amount: number, type: string, partyUserId: string | null, note: string | null): void {
  db.prepare('UPDATE users SET cash = cash + ? WHERE id = ?').run(amount, HOUSE_ID);
  const h = getUserById(HOUSE_ID);
  db.prepare(
    'INSERT INTO bank_transactions (id, at, type, amount, balance_after, party_user_id, note) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(crypto.randomUUID(), Date.now(), type, amount, h?.cash ?? 0, partyUserId, note);
}

/** Создать аккаунт дома с начальным капиталом (один раз) */
function ensureHouse(): void {
  const exists = db.prepare('SELECT 1 AS e FROM users WHERE id = ?').get(HOUSE_ID);
  if (exists) return;
  const start = config.houseStartBalance;
  db.prepare(
    'INSERT INTO users (id, google_id, email, name, avatar, cash, games_played, games_won, is_admin, created_at) VALUES (?, NULL, ?, ?, NULL, ?, 0, 0, 0, ?)',
  ).run(HOUSE_ID, 'house@auctioneer.local', 'Дом', start, Date.now());
  db.prepare(
    'INSERT INTO bank_transactions (id, at, type, amount, balance_after, party_user_id, note) VALUES (?, ?, ?, ?, ?, NULL, ?)',
  ).run(crypto.randomUUID(), Date.now(), 'deposit', start, start, 'Начальный капитал банка дома');
}

/** Баланс и собственность банка (для админ-панели) */
export function getAdminBank(): AdminBank {
  const house = getUserById(HOUSE_ID);
  const inventory = listInventory(HOUSE_ID);
  return {
    balance: house?.cash ?? 0,
    inventory,
    inventoryValue: inventory.reduce((s, i) => s + i.value, 0),
  };
}

/** Журнал операций банка с пагинацией (страница 1 — самые свежие записи) */
export function getBankTransactions(page: number, pageSize: number): BankTxPage {
  const size = Math.max(1, Math.min(500, Math.floor(pageSize) || 30));
  const total = Number((db.prepare('SELECT COUNT(*) AS c FROM bank_transactions').get() as Row | undefined)?.c ?? 0);
  const totalPages = Math.max(1, Math.ceil(total / size));
  const p = Math.min(Math.max(1, Math.floor(page) || 1), totalPages);
  const rows = db.prepare(
    'SELECT t.id, t.at, t.type, t.amount, t.balance_after, t.note, u.name AS party_name FROM bank_transactions t LEFT JOIN users u ON u.id = t.party_user_id ORDER BY t.at DESC, t.rowid DESC LIMIT ? OFFSET ?',
  ).all(size, (p - 1) * size) as unknown as Row[];
  const transactions: BankTx[] = rows.map((r) => ({
    id: String(r.id),
    at: Number(r.at),
    type: String(r.type),
    amount: Number(r.amount),
    balanceAfter: Number(r.balance_after),
    partyName: r.party_name == null ? null : String(r.party_name),
    note: r.note == null ? null : String(r.note),
  }));
  return { transactions, total, page: p, pageSize: size, totalPages };
}

/** Админ: пополнить банк дома (печать средств) */
export function depositBank(adminId: string, amount: number): MarketOpResult {
  amount = Math.floor(amount);
  if (!Number.isFinite(amount) || amount < 1 || amount > 1_000_000_000) {
    return { ok: false, error: 'Сумма должна быть от 1 до 1 000 000 000' };
  }
  houseAdjust(amount, 'deposit', adminId, 'Пополнение банка админом');
  return { ok: true };
}

/** Админ: выплата игроку из банка дома */
export function transferFromBank(adminId: string, email: string, amount: number): MarketOpResult {
  amount = Math.floor(amount);
  if (!Number.isFinite(amount) || amount < 1) return { ok: false, error: 'Сумма должна быть больше нуля' };
  const target = db
    .prepare('SELECT * FROM users WHERE email = ? AND id != ? LIMIT 1')
    .get(String(email).trim().toLowerCase(), HOUSE_ID) as Row | undefined;
  if (!target) return { ok: false, error: 'Игрок с таким email не найден' };
  const targetId = String(target.id);
  const inGame = db.prepare('SELECT 1 AS e FROM items WHERE user_id = ? AND game_id IS NOT NULL LIMIT 1').get(targetId);
  if (inGame) return { ok: false, error: 'Игрок сейчас в партии — выплата недоступна' };
  db.exec('BEGIN');
  try {
    db.prepare('UPDATE users SET cash = cash + ? WHERE id = ?').run(amount, targetId);
    houseAdjust(-amount, 'transfer', targetId, 'Выплата игроку');
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return { ok: true };
}

/** Админ: выставить предмет дома на барахолку */
export function adminListHouseItem(itemId: string, price: number): MarketOpResult {
  return createListing(HOUSE_ID, itemId, price);
}

// ---------- Сетка инвентаря (позиции предметов) ----------

function inventoryOccupancy(userId: string, excludeId?: string): Set<string> {
  const rows = db
    .prepare(
      'SELECT id, inv_x AS x, inv_y AS y, w, h FROM items WHERE user_id = ? AND game_id IS NULL AND inv_x IS NOT NULL AND id NOT IN (SELECT item_id FROM market_listings) AND id NOT IN (SELECT item_id FROM showcase_items)',
    )
    .all(userId) as unknown as Row[];
  const occ = new Set<string>();
  for (const r of rows) {
    if (excludeId && String(r.id) === excludeId) continue;
    const x = Number(r.x);
    const y = Number(r.y);
    for (let dy = 0; dy < Number(r.h); dy++) {
      for (let dx = 0; dx < Number(r.w); dx++) occ.add(x + dx + ',' + (y + dy));
    }
  }
  return occ;
}

/** Первая свободная область для предмета w x h (строки растут вниз) */
/** Первая свободная область для предмета w x h в пределах сетки 12x24 (null — места нет) */
function findFreeSlot(userId: string, w: number, h: number): { x: number; y: number } | null {
  if (w > INV_COLS || h > INV_ROWS) return null;
  const occ = inventoryOccupancy(userId);
  const fits = (x: number, y: number): boolean => {
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        if (x + dx >= INV_COLS || y + dy >= INV_ROWS) return false;
        if (occ.has(x + dx + ',' + (y + dy))) return false;
      }
    }
    return true;
  };
  for (let y = 0; y < INV_ROWS; y++) {
    for (let x = 0; x < INV_COLS; x++) {
      if (fits(x, y)) return { x, y };
    }
  }
  return null;
}

/** Передвинуть предмет в сетке инвентаря (с валидацией пересечений) */
export function moveInventoryItem(userId: string, itemId: string, x: number, y: number): MarketOpResult {
  const item = db
    .prepare('SELECT * FROM items WHERE id = ? AND user_id = ? AND game_id IS NULL')
    .get(itemId, userId) as Row | undefined;
  if (!item) return { ok: false, error: 'Предмет недоступен' };
  const listed = db.prepare('SELECT 1 AS e FROM market_listings WHERE item_id = ?').get(itemId);
  if (listed) return { ok: false, error: 'Сначала снимите предмет с барахолки' };
  const shown = db.prepare('SELECT 1 AS e FROM showcase_items WHERE item_id = ?').get(itemId);
  if (shown) return { ok: false, error: 'Сначала уберите предмет из витрины' };
  x = Math.floor(x);
  y = Math.floor(y);
  const w = Number(item.w);
  const h = Number(item.h);
  if (x < 0 || y < 0 || x + w > INV_COLS || y + h > INV_ROWS) return { ok: false, error: 'Некорректная позиция' };
  const occ = inventoryOccupancy(userId, itemId);
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      if (occ.has(x + dx + ',' + (y + dy))) return { ok: false, error: 'Место занято другим предметом' };
    }
  }
  db.prepare('UPDATE items SET inv_x = ?, inv_y = ? WHERE id = ?').run(x, y, itemId);
  return { ok: true };
}

/** Автосортировка: перепаковать инвентарь по убыванию стоимости (сухая раскладка, потом применение) */
export function sortInventory(userId: string): MarketOpResult {
  const items = db
    .prepare(
      'SELECT id, w, h FROM items WHERE user_id = ? AND game_id IS NULL AND id NOT IN (SELECT item_id FROM market_listings) AND id NOT IN (SELECT item_id FROM showcase_items) ORDER BY value DESC',
    )
    .all(userId) as unknown as Row[];
  // сухая раскладка в памяти
  const occ = new Set<string>();
  const placements: { id: string; x: number; y: number }[] = [];
  const fits = (x: number, y: number, w: number, h: number): boolean => {
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        if (x + dx >= INV_COLS || y + dy >= INV_ROWS) return false;
        if (occ.has(x + dx + ',' + (y + dy))) return false;
      }
    }
    return true;
  };
  for (const it of items) {
    const w = Number(it.w);
    const h = Number(it.h);
    let placed = false;
    outer: for (let y = 0; y < INV_ROWS && !placed; y++) {
      for (let x = 0; x < INV_COLS; x++) {
        if (fits(x, y, w, h)) {
          placements.push({ id: String(it.id), x, y });
          for (let dy = 0; dy < h; dy++) {
            for (let dx = 0; dx < w; dx++) occ.add(x + dx + ',' + (y + dy));
          }
          placed = true;
          break outer;
        }
      }
    }
    if (!placed) return { ok: false, error: 'Не удалось разместить все предметы — освободите место' };
  }
  // применение
  db.prepare(
    'UPDATE items SET inv_x = NULL, inv_y = NULL WHERE user_id = ? AND game_id IS NULL AND id NOT IN (SELECT item_id FROM market_listings) AND id NOT IN (SELECT item_id FROM showcase_items)',
  ).run(userId);
  for (const p of placements) {
    db.prepare('UPDATE items SET inv_x = ?, inv_y = ? WHERE id = ?').run(p.x, p.y, p.id);
  }
  return { ok: true };
}

/** Разовое заполнение позиций (старые записи без позиций или вне сетки 12x24) */
function migrateInventoryPositions(): void {
  const users = db.prepare('SELECT id FROM users WHERE id != ?').all(HOUSE_ID) as unknown as Row[];
  for (const u of users) {
    const uid = String(u.id);
    const base =
      ' FROM items WHERE user_id = ? AND game_id IS NULL AND id NOT IN (SELECT item_id FROM market_listings) AND id NOT IN (SELECT item_id FROM showcase_items)';
    const nulls = db.prepare('SELECT 1 AS e' + base + ' AND inv_x IS NULL LIMIT 1').get(uid);
    const outOfBounds = db
      .prepare('SELECT 1 AS e' + base + ' AND inv_x IS NOT NULL AND (inv_x + w > ? OR inv_y + h > ?) LIMIT 1')
      .get(uid, INV_COLS, INV_ROWS);
    if (nulls || outOfBounds) {
      sortInventory(uid); // сухая раскладка: при неудаче позиции останутся прежними
    }
  }
}
// ---------- Убежище и сеты ----------

/** Активные бонусы сетов игрока (по заполненным витринам) */
export function getActiveSetBonuses(userId: string): string[] {
  const rows = db.prepare('SELECT set_id FROM showcase_items WHERE user_id = ?').all(userId) as unknown as Row[];
  const counts = new Map<string, number>();
  for (const r of rows) {
    const id = String(r.set_id);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const out: string[] = [];
  for (const set of SETS) {
    if ((counts.get(set.id) ?? 0) >= set.itemIds.length) out.push(...set.bonusIds);
  }
  return out;
}

/** Состояние убежища: витрины сетов, прогресс, активные бонусы */
export function getHideout(userId: string): HideoutState {
  const placedRows = db
    .prepare(
      'SELECT s.set_id, s.item_id, i.def_id, i.name, i.rarity, i.value, i.w, i.h FROM showcase_items s JOIN items i ON i.id = s.item_id WHERE s.user_id = ?',
    )
    .all(userId) as unknown as Row[];
  const placedByDef = new Map<string, Row>();
  for (const r of placedRows) placedByDef.set(String(r.def_id), r);
  const activeBonusIds = getActiveSetBonuses(userId);
  const sets: SetProgress[] = SETS.map((set) => {
    const slots = set.itemIds.map((defId) => {
      const def = ITEM_CATALOG.find((d) => d.id === defId);
      const placed = placedByDef.get(defId);
      return {
        defId,
        name: def?.name ?? defId,
        rarity: def?.rarity ?? ('white' as Rarity),
        placed: !!placed,
        itemId: placed ? String(placed.item_id) : undefined,
        value: placed ? Number(placed.value) : undefined,
        w: placed ? Number(placed.w) : undefined,
        h: placed ? Number(placed.h) : undefined,
      };
    });
    const placedCount = slots.filter((s) => s.placed).length;
    return {
      setId: set.id,
      name: set.name,
      subtitle: set.subtitle,
      lore: set.lore,
      bonusTitle: set.bonusTitle,
      bonusText: set.bonusText,
      live: set.live,
      slots,
      placedCount,
      active: placedCount === slots.length,
    };
  });
  const u = getUserById(userId);
  return {
    sets,
    activeBonusIds,
    completedSets: sets.filter((s) => s.active).length,
    totalSets: SETS.length,
    metaActive: sets.every((s) => s.active),
    lastTransmuteAt: u?.lastTransmuteAt ?? 0,
  };
}

/** Поставить предмет в витрину сета */
export function placeShowcaseItem(userId: string, setId: string, itemId: string): MarketOpResult {
  const set = SETS.find((s) => s.id === setId);
  if (!set) return { ok: false, error: 'Сет не найден' };
  const item = db
    .prepare('SELECT * FROM items WHERE id = ? AND user_id = ? AND game_id IS NULL')
    .get(itemId, userId) as Row | undefined;
  if (!item) return { ok: false, error: 'Предмет недоступен' };
  const defId = String(item.def_id);
  if (!set.itemIds.includes(defId)) {
    return { ok: false, error: 'Этот предмет не подходит для сета «' + set.name + '»' };
  }
  const inShowcase = db.prepare('SELECT 1 AS e FROM showcase_items WHERE item_id = ?').get(itemId);
  if (inShowcase) return { ok: false, error: 'Предмет уже в витрине' };
  const slotTaken = db
    .prepare(
      'SELECT 1 AS e FROM showcase_items s JOIN items i ON i.id = s.item_id WHERE s.user_id = ? AND s.set_id = ? AND i.def_id = ?',
    )
    .get(userId, setId, defId);
  if (slotTaken) return { ok: false, error: 'Слот этого предмета уже занят' };
  const listed = db.prepare('SELECT 1 AS e FROM market_listings WHERE item_id = ?').get(itemId);
  if (listed) return { ok: false, error: 'Сначала снимите предмет с барахолки' };
  db.prepare('INSERT INTO showcase_items (item_id, user_id, set_id, placed_at) VALUES (?, ?, ?, ?)').run(
    itemId,
    userId,
    setId,
    Date.now(),
  );
  return { ok: true };
}

/** Убрать предмет из витрины (предмет возвращается в инвентарь) */
export function removeShowcaseItem(userId: string, itemId: string): MarketOpResult {
  const row = db.prepare('SELECT 1 AS e FROM showcase_items WHERE item_id = ? AND user_id = ?').get(itemId, userId);
  if (!row) return { ok: false, error: 'Предмет не найден в витрине' };
  db.prepare('DELETE FROM showcase_items WHERE item_id = ?').run(itemId);
  const item = db.prepare('SELECT w, h FROM items WHERE id = ?').get(itemId) as Row | undefined;
  if (item) {
    const slot = findFreeSlot(userId, Number(item.w), Number(item.h));
    if (slot) db.prepare('UPDATE items SET inv_x = ?, inv_y = ? WHERE id = ?').run(slot.x, slot.y, itemId);
  }
  return { ok: true };
}

/** Трансмутация (сет алхимика): раз в сутки 3 белых -> зелёный (10% шанс синего) */
export function transmute(userId: string): MarketOpResult {
  const bonuses = getActiveSetBonuses(userId);
  if (!bonuses.includes('transmutation')) {
    return { ok: false, error: 'Соберите сет «В поисках философского камня», чтобы открыть трансмутацию' };
  }
  const u = getUserById(userId);
  if (!u) return { ok: false, error: 'Пользователь не найден' };
  const now = Date.now();
  if (now - u.lastTransmuteAt < 24 * 60 * 60 * 1000) {
    return { ok: false, error: 'Трансмутация доступна раз в сутки' };
  }
  const whites = db
    .prepare(
      "SELECT * FROM items WHERE user_id = ? AND rarity = 'white' AND game_id IS NULL AND id NOT IN (SELECT item_id FROM market_listings) AND id NOT IN (SELECT item_id FROM showcase_items) ORDER BY value ASC LIMIT 3",
    )
    .all(userId) as unknown as Row[];
  if (whites.length < 3) return { ok: false, error: 'Нужно 3 белых предмета в инвентаре' };
  const rarity: Rarity = Math.random() < 0.1 ? 'blue' : 'green';
  const pool = ITEM_CATALOG.filter((d) => d.rarity === rarity);
  const def = pool[Math.floor(Math.random() * pool.length)];
  const newItem: ItemInstance = {
    id: crypto.randomUUID(),
    defId: def.id,
    name: def.name,
    rarity,
    value: def.value,
    w: def.w,
    h: def.h,
  };
  const slot = findFreeSlot(userId, newItem.w, newItem.h);
  if (!slot) return { ok: false, error: 'Нет места в инвентаре — освободите сетку' };
  db.exec('BEGIN');
  try {
    for (const w of whites) db.prepare('DELETE FROM items WHERE id = ?').run(String(w.id));
    db.prepare(
      'INSERT INTO items (id, user_id, def_id, name, rarity, value, w, h, game_id, inv_x, inv_y, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)',
    ).run(newItem.id, userId, newItem.defId, newItem.name, newItem.rarity, newItem.value, newItem.w, newItem.h, slot.x, slot.y, now);
    db.prepare('UPDATE users SET last_transmute_at = ? WHERE id = ?').run(now, userId);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return { ok: true, item: newItem };
}

/** Админ: выдать игроку предмет из каталога (для тестов и наград) */
export function adminGrantItem(email: string, defId: string): MarketOpResult {
  const target = db
    .prepare('SELECT * FROM users WHERE email = ? AND id != ? LIMIT 1')
    .get(String(email).trim().toLowerCase(), HOUSE_ID) as Row | undefined;
  if (!target) return { ok: false, error: 'Игрок не найден' };
  const def = ITEM_CATALOG.find((d) => d.id === defId);
  if (!def) return { ok: false, error: 'Предмет каталога не найден' };
  const item: ItemInstance = {
    id: crypto.randomUUID(),
    defId: def.id,
    name: def.name,
    rarity: def.rarity,
    value: def.value,
    w: def.w,
    h: def.h,
  };
  const targetId = String(target.id);
  const slot = findFreeSlot(targetId, item.w, item.h);
  if (!slot) return { ok: false, error: 'У игрока нет места в инвентаре' };
  db.prepare(
    'INSERT INTO items (id, user_id, def_id, name, rarity, value, w, h, game_id, inv_x, inv_y, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)',
  ).run(item.id, targetId, item.defId, item.name, item.rarity, item.value, item.w, item.h, slot.x, slot.y, Date.now());
  houseAdjust(0, 'admin_item', targetId, 'Выдача предмета «' + item.name + '» админом');
  return { ok: true, item };
}

// ---------- Тайный Санта ----------

function santaRows(userId: string): Row[] {
  return db.prepare('SELECT * FROM santa_items WHERE user_id = ?').all(userId) as unknown as Row[];
}

/** Занятые клетки ящика 9x9 (вложения и размещённый дроп) */
function santaOccupancy(userId: string, excludeId?: string): Set<string> {
  const occ = new Set<string>();
  for (const r of santaRows(userId)) {
    if (r.pending) continue;
    if (excludeId && String(r.id) === excludeId) continue;
    const x = Number(r.x);
    const y = Number(r.y);
    for (let dy = 0; dy < Number(r.h); dy++) {
      for (let dx = 0; dx < Number(r.w); dx++) occ.add(x + dx + ',' + (y + dy));
    }
  }
  return occ;
}

/**
 * Текущий круг: сумма вложений и момент дропа.
 * Круг запускается только после SANTA_MIN_ITEMS вложений (анти-абуз):
 * пока вложено меньше, deadline = null и дроп не произойдёт.
 */
function santaCycle(userId: string): { value: number; count: number; deadline: number | null } | null {
  const rows = db
    .prepare("SELECT value, created_at FROM santa_items WHERE user_id = ? AND kind = 'sacrifice'")
    .all(userId) as unknown as Row[];
  if (rows.length === 0) return null;
  let value = 0;
  let lastAt = 0;
  for (const r of rows) {
    value += Number(r.value);
    lastAt = Math.max(lastAt, Number(r.created_at));
  }
  if (rows.length < SANTA_MIN_ITEMS) return { value, count: rows.length, deadline: null };
  return { value, count: rows.length, deadline: lastAt + santaTimerMs(value) };
}

/** Первое свободное место в ящике 9x9 для предмета w x h (null — места нет) */
function findFreeSantaSlot(userId: string, w: number, h: number): { x: number; y: number } | null {
  if (w > SANTA_COLS || h > SANTA_ROWS) return null;
  const occ = santaOccupancy(userId);
  const fits = (x: number, y: number): boolean => {
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        if (x + dx >= SANTA_COLS || y + dy >= SANTA_ROWS) return false;
        if (occ.has(x + dx + ',' + (y + dy))) return false;
      }
    }
    return true;
  };
  for (let y = 0; y < SANTA_ROWS; y++) {
    for (let x = 0; x < SANTA_COLS; x++) {
      if (fits(x, y)) return { x, y };
    }
  }
  return null;
}

/** Разместить дроп, ожидающий свободных клеток; вернуть число размещённых предметов */
function placePendingSantaRewards(userId: string): number {
  const pending = db
    .prepare('SELECT * FROM santa_items WHERE user_id = ? AND pending = 1 ORDER BY created_at ASC, rowid ASC')
    .all(userId) as unknown as Row[];
  let placed = 0;
  const upd = db.prepare('UPDATE santa_items SET x = ?, y = ?, pending = 0 WHERE id = ?');
  for (const r of pending) {
    const slot = findFreeSantaSlot(userId, Number(r.w), Number(r.h));
    if (slot) {
      upd.run(slot.x, slot.y, String(r.id));
      placed++;
    }
  }
  return placed;
}

/**
 * Завершить истёкший круг: вложения исчезают, в ящик падает случайный дроп,
 * итог круга (вложено/получено) записывается в журнал для модального окна.
 */
function settleSantaCycle(userId: string): void {
  const cycle = santaCycle(userId);
  if (!cycle || cycle.deadline === null || Date.now() < cycle.deadline) return;
  const rng = Math.random;
  const count = santaRewardCount(rng, cycle.value);
  const ins = db.prepare(
    "INSERT INTO santa_items (id, user_id, def_id, name, rarity, value, w, h, kind, pending, x, y, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'reward', 1, NULL, NULL, ?)",
  );
  const insCycle = db.prepare(
    'INSERT INTO santa_cycles (id, user_id, completed_at, items_in, value_in, items_out, value_out) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  db.exec('BEGIN');
  try {
    const rewards: { value: number }[] = [];
    db.prepare("DELETE FROM santa_items WHERE user_id = ? AND kind = 'sacrifice'").run(userId);
    for (let i = 0; i < count; i++) {
      const it = generateSantaReward(rng, cycle.value);
      rewards.push(it);
      ins.run(it.id, userId, it.defId, it.name, it.rarity, it.value, it.w, it.h, Date.now());
    }
    const valueOut = rewards.reduce((s, it) => s + it.value, 0);
    insCycle.run(crypto.randomUUID(), userId, Date.now(), cycle.count, cycle.value, rewards.length, valueOut);
    // храним только последние 20 кругов на игрока
    db.prepare(
      'DELETE FROM santa_cycles WHERE user_id = ? AND id NOT IN (SELECT id FROM santa_cycles WHERE user_id = ? ORDER BY completed_at DESC, rowid DESC LIMIT 20)',
    ).run(userId, userId);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  placePendingSantaRewards(userId);
}

function mapSantaRow(r: Row): SantaBoxItem {
  return {
    id: String(r.id),
    defId: String(r.def_id),
    name: String(r.name),
    rarity: String(r.rarity) as Rarity,
    value: Number(r.value),
    w: Number(r.w),
    h: Number(r.h),
    kind: String(r.kind) as SantaBoxItem['kind'],
    x: r.x == null ? undefined : Number(r.x),
    y: r.y == null ? undefined : Number(r.y),
  };
}

/** Состояние ящика Тайного Санты (круг завершается лениво — при обращении) */
export function getSanta(userId: string): SantaState {
  settleSantaCycle(userId);
  placePendingSantaRewards(userId);
  const cycle = santaCycle(userId);
  const rows = santaRows(userId);
  const last = db
    .prepare('SELECT * FROM santa_cycles WHERE user_id = ? ORDER BY completed_at DESC, rowid DESC LIMIT 1')
    .get(userId) as Row | undefined;
  return {
    box: rows.filter((r) => !r.pending).map(mapSantaRow),
    pending: rows.filter((r) => !!r.pending).map(mapSantaRow),
    poolValue: cycle?.value ?? 0,
    deadline: cycle?.deadline ?? null,
    lastCycle: last
      ? {
          id: String(last.id),
          at: Number(last.completed_at),
          itemsIn: Number(last.items_in),
          valueIn: Number(last.value_in),
          itemsOut: Number(last.items_out),
          valueOut: Number(last.value_out),
        }
      : null,
  };
}

/**
 * Безвозвратно вложить предмет из инвентаря в ящик.
 * x/y — клетка в сетке 9x9; если не заданы, сервер найдёт место сам.
 */
export function sacrificeToSanta(userId: string, itemId: string, x?: number, y?: number): MarketOpResult {
  settleSantaCycle(userId);
  placePendingSantaRewards(userId);
  const item = db
    .prepare('SELECT * FROM items WHERE id = ? AND user_id = ? AND game_id IS NULL')
    .get(itemId, userId) as Row | undefined;
  if (!item) return { ok: false, error: 'Предмет недоступен для вложения' };
  const listed = db.prepare('SELECT 1 AS e FROM market_listings WHERE item_id = ?').get(itemId);
  if (listed) return { ok: false, error: 'Сначала снимите предмет с барахолки' };
  const shown = db.prepare('SELECT 1 AS e FROM showcase_items WHERE item_id = ?').get(itemId);
  if (shown) return { ok: false, error: 'Сначала уберите предмет из витрины' };
  const w = Number(item.w);
  const h = Number(item.h);
  let target: { x: number; y: number } | null = null;
  if (x === undefined || y === undefined || !Number.isFinite(x) || !Number.isFinite(y)) {
    target = findFreeSantaSlot(userId, w, h);
  } else {
    const fx = Math.floor(x);
    const fy = Math.floor(y);
    if (fx < 0 || fy < 0 || fx + w > SANTA_COLS || fy + h > SANTA_ROWS) {
      return { ok: false, error: 'Некорректная позиция в ящике' };
    }
    const occ = santaOccupancy(userId);
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        if (occ.has(fx + dx + ',' + (fy + dy))) return { ok: false, error: 'Место в ящике занято' };
      }
    }
    target = { x: fx, y: fy };
  }
  if (!target) return { ok: false, error: 'Нет свободного места в ящике' };
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM items WHERE id = ?').run(itemId);
    db.prepare(
      "INSERT INTO santa_items (id, user_id, def_id, name, rarity, value, w, h, kind, pending, x, y, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'sacrifice', 0, ?, ?, ?)",
    ).run(itemId, userId, String(item.def_id), String(item.name), String(item.rarity), Number(item.value), w, h, target.x, target.y, Date.now());
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return { ok: true, value: Number(item.value) };
}

/**
 * Забрать выпавший предмет из ящика в инвентарь.
 * x/y — клетка в сетке инвентаря 12x24; если не заданы, сервер найдёт место сам.
 */
export function takeFromSanta(userId: string, itemId: string, x?: number, y?: number): MarketOpResult {
  settleSantaCycle(userId);
  placePendingSantaRewards(userId);
  const row = db.prepare('SELECT * FROM santa_items WHERE id = ? AND user_id = ?').get(itemId, userId) as Row | undefined;
  if (!row) return { ok: false, error: 'Предмет не найден в ящике' };
  if (String(row.kind) !== 'reward' || Number(row.pending) === 1) {
    return { ok: false, error: 'Этот предмет ещё нельзя забрать' };
  }
  const w = Number(row.w);
  const h = Number(row.h);
  let target: { x: number; y: number } | null = null;
  if (x === undefined || y === undefined || !Number.isFinite(x) || !Number.isFinite(y)) {
    target = findFreeSlot(userId, w, h);
  } else {
    const fx = Math.floor(x);
    const fy = Math.floor(y);
    if (fx < 0 || fy < 0 || fx + w > INV_COLS || fy + h > INV_ROWS) {
      return { ok: false, error: 'Некорректная позиция в инвентаре' };
    }
    const occ = inventoryOccupancy(userId);
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        if (occ.has(fx + dx + ',' + (fy + dy))) return { ok: false, error: 'Место в инвентаре занято' };
      }
    }
    target = { x: fx, y: fy };
  }
  if (!target) return { ok: false, error: 'Нет места в инвентаре — освободите сетку' };
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM santa_items WHERE id = ?').run(itemId);
    db.prepare(
      'INSERT INTO items (id, user_id, def_id, name, rarity, value, w, h, game_id, inv_x, inv_y, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)',
    ).run(itemId, userId, String(row.def_id), String(row.name), String(row.rarity), Number(row.value), w, h, target.x, target.y, Date.now());
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  placePendingSantaRewards(userId);
  return {
    ok: true,
    item: {
      id: itemId,
      defId: String(row.def_id),
      name: String(row.name),
      rarity: String(row.rarity) as Rarity,
      value: Number(row.value),
      w,
      h,
    },
  };
}

// ---------- Особые карточки и магазин ----------

export interface PlayerCardGroup {
  cardId: string;
  count: number;
}

/** Карточки игрока, сгруппированные по определению (в порядке каталога карточек) */
export function getCards(userId: string): PlayerCardGroup[] {
  const rows = db
    .prepare('SELECT card_id, COUNT(*) AS n FROM cards WHERE user_id = ? GROUP BY card_id')
    .all(userId) as unknown as Row[];
  const byCard = new Map(rows.map((r) => [String(r.card_id), Number(r.n)]));
  const out: PlayerCardGroup[] = [];
  for (const def of CARD_DEFS) {
    const count = byCard.get(def.id) ?? 0;
    if (count > 0) out.push({ cardId: def.id, count });
  }
  return out;
}

/** Число «Пыльных ваз» в свободном инвентаре (билеты для колеса фортуны) */
function countVases(userId: string): number {
  const row = db
    .prepare(
      'SELECT COUNT(*) AS n FROM items WHERE user_id = ? AND def_id = ? AND game_id IS NULL AND id NOT IN (SELECT item_id FROM market_listings) AND id NOT IN (SELECT item_id FROM showcase_items)',
    )
    .get(userId, WHEEL_TICKET_DEF_ID) as Row | undefined;
  return Number(row?.n ?? 0);
}

export interface ShopState {
  cards: PlayerCardGroup[];
  vaseCount: number;
  ticketDefId: string;
  ticketName: string;
  ticketValue: number;
}

/** Состояние магазина: билеты (вазы), коллекция карточек */
export function getShopState(userId: string): ShopState {
  const ticket = ITEM_CATALOG.find((d) => d.id === WHEEL_TICKET_DEF_ID);
  return {
    cards: getCards(userId),
    vaseCount: countVases(userId),
    ticketDefId: WHEEL_TICKET_DEF_ID,
    ticketName: WHEEL_TICKET_NAME,
    ticketValue: ticket?.value ?? 0,
  };
}

export interface SpinResult {
  ok: boolean;
  error?: string;
  cardId?: string;
  cardName?: string;
  setId?: 'analyzers' | 'amplifiers';
  instanceId?: string;
}

/** Крутка колеса фортуны: тратит 1 «Пыльную вазу» и выдаёт случайную карточку */
export function spinWheel(userId: string, rng: () => number = Math.random): SpinResult {
  const vase = db
    .prepare(
      'SELECT id FROM items WHERE user_id = ? AND def_id = ? AND game_id IS NULL AND id NOT IN (SELECT item_id FROM market_listings) AND id NOT IN (SELECT item_id FROM showcase_items) LIMIT 1',
    )
    .get(userId, WHEEL_TICKET_DEF_ID) as Row | undefined;
  if (!vase) {
    return { ok: false, error: 'Для крутки нужна «' + WHEEL_TICKET_NAME + '» — билет колеса фортуны' };
  }
  const def = pickCardByWeight(rng);
  const instanceId = crypto.randomUUID();
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM items WHERE id = ?').run(String(vase.id));
    db.prepare('INSERT INTO cards (id, user_id, card_id, created_at) VALUES (?, ?, ?, ?)').run(
      instanceId,
      userId,
      def.id,
      Date.now(),
    );
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return { ok: true, cardId: def.id, cardName: def.name, setId: def.setId, instanceId };
}

/** Потратить одну карточку игрока указанного вида (самую старую) */
export function consumeCardByDef(userId: string, cardId: string): boolean {
  const row = db
    .prepare('SELECT id FROM cards WHERE user_id = ? AND card_id = ? ORDER BY created_at ASC, rowid ASC LIMIT 1')
    .get(userId, cardId) as Row | undefined;
  if (!row) return false;
  db.prepare('DELETE FROM cards WHERE id = ?').run(String(row.id));
  return true;
}

export interface AmplifyResult {
  ok: boolean;
  error?: string;
  /** что было превращено */
  removed?: { name: string; rarity: Rarity; value: number };
  /** что получено */
  item?: ItemInstance;
}

/**
 * Усилитель: случайный свободный предмет инвентаря слабее целевого качества
 * превращается в случайный предмет нужного качества (никогда не понижает).
 */
export function amplifyItem(userId: string, cardId: string): AmplifyResult {
  const def = findCard(cardId);
  if (!def || def.setId !== 'amplifiers' || !def.rarity) return { ok: false, error: 'Карточка не найдена' };
  const target = def.rarity;
  const targetIdx = RARITY_ORDER.indexOf(target);
  const owned = db
    .prepare('SELECT id FROM cards WHERE user_id = ? AND card_id = ? ORDER BY created_at ASC, rowid ASC LIMIT 1')
    .get(userId, cardId) as Row | undefined;
  if (!owned) return { ok: false, error: 'У вас нет карточки «' + def.name + '»' };
  const candidates = db
    .prepare(
      'SELECT * FROM items WHERE user_id = ? AND game_id IS NULL AND id NOT IN (SELECT item_id FROM market_listings) AND id NOT IN (SELECT item_id FROM showcase_items)',
    )
    .all(userId) as unknown as Row[];
  const weaker = candidates.filter((r) => RARITY_ORDER.indexOf(String(r.rarity) as Rarity) < targetIdx);
  if (weaker.length === 0) {
    return { ok: false, error: 'Нет предметов слабее «' + RARITY_LABEL[target] + '» качества — усиление не к чему применить' };
  }
  const victim = weaker[Math.floor(Math.random() * weaker.length)];
  const pool = ITEM_CATALOG.filter((d) => d.rarity === target);
  const nd = pool[Math.floor(Math.random() * pool.length)];
  const newItem: ItemInstance = {
    id: crypto.randomUUID(),
    defId: nd.id,
    name: nd.name,
    rarity: nd.rarity,
    value: nd.value,
    w: nd.w,
    h: nd.h,
  };
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM items WHERE id = ?').run(String(victim.id));
    const slot = findFreeSlot(userId, newItem.w, newItem.h);
    if (!slot) {
      db.exec('ROLLBACK');
      return { ok: false, error: 'Нет места в инвентаре для усиленного предмета' };
    }
    db.prepare(
      'INSERT INTO items (id, user_id, def_id, name, rarity, value, w, h, game_id, inv_x, inv_y, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)',
    ).run(
      newItem.id,
      userId,
      newItem.defId,
      newItem.name,
      newItem.rarity,
      newItem.value,
      newItem.w,
      newItem.h,
      slot.x,
      slot.y,
      Date.now(),
    );
    db.prepare('DELETE FROM cards WHERE id = ?').run(String(owned.id));
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return {
    ok: true,
    removed: { name: String(victim.name), rarity: String(victim.rarity) as Rarity, value: Number(victim.value) },
    item: newItem,
  };
}

