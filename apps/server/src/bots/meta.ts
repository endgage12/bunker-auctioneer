// Мета-игра бота между партиями: торговец, барахолка, колесо фортуны,
// усилители, сеты и «Тайный Санта». Всё — через обычный REST API,
// то есть теми же действиями, что доступны человеку.
import type { BotCharacter, InventoryRow, MarketListing, Profile } from '@auctioneer/shared';
import type { Rng } from './brain';
import { BOT_MIN_CASH } from './options';

/** Минимальная цена лота, чтобы бот не разорялся на комиссии */
const MIN_LIST_PRICE = 3_000;

async function api<T>(origin: string, token: string, path: string, init?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(origin + path, {
      ...init,
      headers: {
        Authorization: 'Bearer ' + token,
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init?.headers as Record<string, string> | undefined),
      },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

const get = <T>(origin: string, token: string, path: string) => api<T>(origin, token, path);
const post = <T>(origin: string, token: string, path: string, body?: unknown) =>
  api<T>(origin, token, path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });

/** Оценка «хлама»: предмет дешевле этой суммы не жалко продать торговцу */
/**
 * Целевой запас наличных, до которого бот распродаёт предметы.
 * Партия стоит боту ~90к (взнос + ставка), поэтому запас должен покрывать
 * несколько партий подряд: иначе бот продаёт по одному предмету перед каждой
 * игрой и всё равно не успевает восстановиться.
 */
const EMERGENCY_CASH = 900_000;
/** Максимум предметов, которые бот продаёт за одну попытку пополнения */
const EMERGENCY_SELL_LIMIT = 40;

function clutterThreshold(character: BotCharacter): number {
  // жадные держат даже мелочь, паникёры распродают всё лишнее
  return Math.round(6_000 + character.greed * 14_000 - character.blunder * 4_000);
}

/**
 * Один заход мета-игры. Вызывается после партии, поэтому действий немного:
 * бот «живёт» между партиями, а не выполняет всё сразу.
 */
export async function botMetaGame(
  origin: string,
  token: string,
  userId: string,
  character: BotCharacter,
  rng: Rng,
): Promise<void> {
  const me = await get<Profile>(origin, token, '/api/me');
  if (!me) return;

  // 1. Продажа хлама торговцу — освобождает место в инвентаре.
  //    Если наличных мало (нечем делать вступительную ставку), бот распродаёт
  //    заметно больше: это его способ вернуться в игру, а не выпасть из парка.
  const threshold = clutterThreshold(character);
  const needCash = me.cash < BOT_MIN_CASH;
  const emergency = me.cash < BOT_MIN_CASH && character.sessionPatience >= 0;
  // В режиме нехватки денег продаём не «хлам по порогу», а самые дешёвые
  // предметы подряд, пока не наберём безопасный запас наличных. Иначе бот
  // застревает: играть не может, а распродаёт по 3 предмета за заход.
  const limit = emergency
    ? EMERGENCY_SELL_LIMIT
    : needCash
      ? 8 + Math.floor(rng() * 5)
      : 3 + Math.floor(rng() * 3);
  const maxValue = emergency ? Number.POSITIVE_INFINITY : threshold;
  // При нехватке денег выгоднее продать несколько дорогих предметов, чем
  // выгрести всю мелочь: торговец платит долю номинала, и крупные лоты
  // быстрее закрывают потребность в наличных.
  const clutter = me.inventory
    .filter((i) => i.value <= maxValue)
    .sort((a, b) => (emergency ? b.value - a.value : a.value - b.value))
    .slice(0, limit);
  let gained = 0;
  for (const item of clutter) {
    const before = gained;
    const ok = await post(origin, token, '/api/items/sell', { itemId: item.id });
    if (!ok) break; // банк дома не может платить — дальше нет смысла
    gained = before + Math.round(item.value * 0.7);
    if (emergency && me.cash + gained >= EMERGENCY_CASH) break; // запаса хватит
  }

  // 2. Колесо фортуны: билет — «Пыльная ваза»
  if (rng() < 0.5) {
    const shop = await get<{ spins?: number }>(origin, token, '/api/shop');
    if (shop && (shop.spins ?? 0) > 0) await post(origin, token, '/api/shop/spin');
  }

  // 3. Усилители: применить карточку на случайный предмет
  if (rng() < 0.4) {
    const cards = await get<Array<{ cardId: string; setId: string }>>(origin, token, '/api/cards');
    const booster = cards?.find((c) => c.setId === 'boosters');
    if (booster) await post(origin, token, '/api/cards/amplify', { cardId: booster.cardId });
  }

  // 4. Барахолка: выставить дорогую вещь и/или подобрать выгодный лот
  const market = await get<MarketListing[]>(origin, token, '/api/market');
  if (market) {
    // 4a. Выставить один предмет дороже порога, если у бота их достаточно
    if (rng() < 0.35) {
      const pricey = me.inventory
        .filter((i) => i.value > threshold * 3)
        .sort((a, b) => b.value - a.value);
      const pick = pricey[Math.floor(rng() * Math.min(3, pricey.length))];
      if (pick) {
        // цена «по-человечески»: около номинала с небольшим наваром
        const price = Math.max(MIN_LIST_PRICE, Math.round(pick.value * (1.05 + rng() * 0.3)));
        await post(origin, token, '/api/market/list', { itemId: pick.id, price });
      }
    }
    // 4b. Купить лот заметно ниже номинала (выгодная сделка)
    const bargains = market
      .filter((l) => !l.mine && l.sellerId !== userId && l.price < l.item.value * 0.9)
      .sort((a, b) => a.price - b.price);
    const bargain = bargains[0];
    if (bargain && me.cash > bargain.price * 2 && rng() < 0.5) {
      await post(origin, token, '/api/market/buy', { listingId: bargain.id });
    }
  }

  // 5. Сеты: поставить предмет в витрину, если он подходит к незаполненному сету
  if (rng() < 0.25) {
    const hideout = await get<{ sets?: Array<{ id: string; complete: boolean; placed: string[]; pool?: string[] }> }>(
      origin,
      token,
      '/api/hideout',
    );
    const target = hideout?.sets?.find((s) => !s.complete && (s.placed?.length ?? 0) === 0);
    if (target) {
      const candidate = me.inventory.find((i) => i.value > threshold);
      if (candidate) await post(origin, token, '/api/hideout/place', { setId: target.id, itemId: candidate.id });
    }
  }

  // 6. «Тайный Санта»: иногда вложить дешёвый предмет ради случайного дропа
  if (rng() < 0.2) {
    const santa = await get<{ box?: { items?: unknown[] } }>(origin, token, '/api/santa');
    if (santa && (santa.box?.items?.length ?? 0) === 0) {
      const cheap = cheapest(me.inventory);
      if (cheap && rng() < 0.5) {
        await post(origin, token, '/api/santa/sacrifice', { itemId: cheap.id });
        // забрать дроп, если он уже появился (таймер короткий только при крупных вложениях)
        const after = await get<{ box?: { items?: InventoryRow[] } }>(origin, token, '/api/santa');
        for (const it of after?.box?.items ?? []) {
          await post(origin, token, '/api/santa/take', { itemId: it.id });
        }
      }
    }
  }

  // 7. Трансмутация алхимика (суточная) — если есть три белых предмета
  if (rng() < 0.2) {
    await post(origin, token, '/api/hideout/transmute');
  }
}

function cheapest(inventory: InventoryRow[]): InventoryRow | undefined {
  return [...inventory].sort((a, b) => a.value - b.value)[0];
}
