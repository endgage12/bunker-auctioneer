// Тесты особых карточек и крафта.
//
// Три правила, которые проверяем:
// 1. За один раунд торгов применяется только одна особая карточка.
// 2. Карточки покупаются на общем рынке — как игрок, так и бот.
// 3. «Пыльная ваза» (билет колеса) крафтится из трёх предметов одного качества.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CRAFT_ITEMS_PER_RECIPE,
  CRAFT_RECIPES,
  RARITY_ORDER,
  TIERS,
  WHEEL_TICKET_DEF_ID,
  findCard,
} from '@auctioneer/shared';
import type { ItemInstance } from '@auctioneer/shared';
import { Game } from '../src/game/engine';
import type { EnginePlayerSeed } from '../src/game/engine';

const TEST_DB = resolve(process.cwd(), '..', '..', 'data', 'test-cards-market.db');
let db: typeof import('../src/db');

beforeAll(async () => {
  for (const f of [TEST_DB, TEST_DB + '-wal', TEST_DB + '-shm']) {
    if (existsSync(f)) rmSync(f, { force: true });
  }
  process.env.DB_PATH = TEST_DB;
  db = await import('../src/db');
});

afterAll(() => {
  vi.useRealTimers();
  for (const f of [TEST_DB, TEST_DB + '-wal', TEST_DB + '-shm']) {
    if (existsSync(f)) rmSync(f, { force: true });
  }
});

/** Сколько копий карточки в руке */
function countOf(cards: { cardId: string; count: number }[], cardId: string): number {
  return cards.find((c) => c.cardId === cardId)?.count ?? 0;
}

function item(id: string, value: number, rarity = 'white'): ItemInstance {
  return { id, defId: 'x', name: 'Предмет ' + id, rarity, value, w: 1, h: 1 } as ItemInstance;
}

/** Партия двух игроков, где стол известен заранее */
function makeGame(players: EnginePlayerSeed[]): Game {
  return new Game({
    id: 'cards-' + Math.random().toString(36).slice(2, 8),
    code: 'CRD',
    hostId: players[0].id,
    players,
    now: () => 0,
    tier: TIERS.bronze,
    // Стол из нескольких предметов: анализатору нужны СКРЫТЫЕ предметы,
    // а один предмет может оказаться уже раскрытым в первом раунде.
    tableItems: Array.from({ length: 8 }, (_, i) => item('p' + i, 18_000)),
  });
}

/** Довести партию до фазы торгов */
function toAuction(g: Game): void {
  for (const p of g.debug().players) g.confirmEntry(p.id);
  g.advance();
  for (let i = 0; i < 40; i++) {
    if (g.snapshot().auction?.phase === 'bid') return;
    g.advance();
  }
  throw new Error('не дошли до торгов');
}

describe('лимит карточек: одна за раунд', () => {
  it('вторая карточка в том же раунде отклоняется', () => {
    const g = makeGame([
      { id: 'a', name: 'А', cash: 500_000, inventory: [] },
      { id: 'b', name: 'Б', cash: 500_000, inventory: [] },
    ]);
    toAuction(g);

    expect(g.useAnalyzerCard('a', 2), 'первая карточка проходит').toBeNull();
    const second = g.useAnalyzerCard('a', 2);
    expect(second, 'вторая карточка в том же раунде запрещена').toBeTruthy();
    expect(second).toContain('одну особую карточку');
  });

  it('в новом раунде лимит сбрасывается', () => {
    const g = makeGame([
      { id: 'a', name: 'А', cash: 500_000, inventory: [] },
      { id: 'b', name: 'Б', cash: 500_000, inventory: [] },
    ]);
    toAuction(g);
    expect(g.useAnalyzerCard('a', 2)).toBeNull();

    // доходим до следующего раунда: сбрасываем ставки и прокручиваем партию.
    // Победителя в первом раунде нет (оба пасуют), поэтому раунд сменяется.
    g.submitBid('a', 0);
    g.submitBid('b', 0);
    let sawRound2 = false;
    for (let i = 0; i < 20; i++) {
      g.advance();
      const a = g.snapshot().auction;
      if (a?.round === 2) {
        sawRound2 = true;
        if (a.phase === 'bid') break;
      }
    }
    expect(sawRound2, 'начался второй раунд').toBe(true);
    expect(g.useAnalyzerCard('a', 2), 'в новом раунде карточка снова доступна').toBeNull();
  });

  it('счётчик использования виден в публичном снимке', () => {
    const g = makeGame([
      { id: 'a', name: 'А', cash: 500_000, inventory: [] },
      { id: 'b', name: 'Б', cash: 500_000, inventory: [] },
    ]);
    toAuction(g);
    const before = g.snapshot().players.find((p) => p.id === 'a')!.cardsUsedThisRound ?? 0;
    expect(before).toBe(0);
    g.useAnalyzerCard('a', 2);
    const after = g.snapshot().players.find((p) => p.id === 'a')!.cardsUsedThisRound ?? 0;
    expect(after, 'счётчик вырос').toBe(1);
  });

  it('карточка одного игрока не мешает другому', () => {
    const g = makeGame([
      { id: 'a', name: 'А', cash: 500_000, inventory: [] },
      { id: 'b', name: 'Б', cash: 500_000, inventory: [] },
    ]);
    toAuction(g);
    expect(g.useAnalyzerCard('a', 2)).toBeNull();
    expect(g.useAnalyzerCard('b', 2), 'у второго игрока свой лимит').toBeNull();
    expect(g.useAnalyzerCard('b', 2), 'но не больше одной').toBeTruthy();
  });
});

describe('крафт билета колеса: три предмета одного качества', () => {
  it('каталог рецептов покрывает все качества', () => {
    for (const r of RARITY_ORDER) {
      expect(CRAFT_RECIPES.some((x) => x.fromRarity === r), 'есть рецепт для ' + r).toBe(true);
    }
    expect(CRAFT_ITEMS_PER_RECIPE).toBe(3);
  });

  it('три предмета одного качества превращаются в билет', () => {
    const user = db.findOrCreateDevUser('craft-white@test.dev', 'Крафтер');
    // выдаём три белых предмета
    for (let i = 0; i < 3; i++) {
      const r = db.adminGrantItem('craft-white@test.dev', 'white-2');
      expect(r.ok, 'предмет выдан').toBe(true);
    }
    // у нового игрока есть стартовый набор, поэтому считаем РАЗНИЦУ
    const invBefore = db.getProfile(user.id)!.inventory;
    const whitesBefore = invBefore.filter((i) => i.rarity === 'white' && i.defId !== WHEEL_TICKET_DEF_ID).length;
    const ticketsBefore = invBefore.filter((i) => i.defId === WHEEL_TICKET_DEF_ID).length;
    expect(whitesBefore, 'белых предметов достаточно').toBeGreaterThanOrEqual(3);

    const res = db.craftVase(user.id, 'white');
    expect(res.ok, res.error ?? '').toBe(true);
    expect(res.item?.defId, 'получилась пыльная ваза').toBe(WHEEL_TICKET_DEF_ID);

    const invAfter = db.getProfile(user.id)!.inventory;
    const whitesAfter = invAfter.filter((i) => i.rarity === 'white' && i.defId !== WHEEL_TICKET_DEF_ID).length;
    const ticketsAfter = invAfter.filter((i) => i.defId === WHEEL_TICKET_DEF_ID).length;
    expect(whitesAfter, 'ровно три предмета списаны').toBe(whitesBefore - 3);
    expect(ticketsAfter, 'билет добавился').toBe(ticketsBefore + 1);
  });

  it('не хватает предметов — крафт отклоняется с понятной причиной', () => {
    const user = db.findOrCreateDevUser('craft-poor@test.dev', 'Бедный');
    const res = db.craftVase(user.id, 'red');
    expect(res.ok).toBe(false);
    expect(res.error).toContain('Нужно 3 предмета');
  });

  it('предметы разного цвета не смешиваются', () => {
    const user = db.findOrCreateDevUser('craft-mixed@test.dev', 'Смешанный');
    // вычищаем инвентарь, чтобы условие было ровно «два белых и один зелёный»
    for (const it of db.getProfile(user.id)!.inventory) {
      db.deleteItemForTest(user.id, it.id);
    }
    db.adminGrantItem('craft-mixed@test.dev', 'white-2');
    db.adminGrantItem('craft-mixed@test.dev', 'white-3');
    db.adminGrantItem('craft-mixed@test.dev', 'green-0');

    const options = db.craftOptions(user.id);
    const white = options.find((o) => o.rarity === 'white')!;
    const green = options.find((o) => o.rarity === 'green')!;
    expect(white.available, 'белых только два').toBe(2);
    expect(white.ready, 'для белого рецепта не хватает').toBe(false);
    expect(green.available, 'зелёный один').toBe(1);
    expect(green.ready, 'зелёного тоже не хватает').toBe(false);
    expect(db.craftVase(user.id, 'white').ok, 'смешивать цвета нельзя').toBe(false);
    expect(db.craftVase(user.id, 'green').ok).toBe(false);
  });

  it('после крафта билет можно потратить на колесо', () => {
    const user = db.findOrCreateDevUser('craft-spin@test.dev', 'Крутящий');
    for (let i = 0; i < 3; i++) db.adminGrantItem('craft-spin@test.dev', 'white-4');
    expect(db.craftVase(user.id, 'white').ok).toBe(true);
    const shop = db.getShopState(user.id);
    expect(shop.vaseCount, 'билет виден колесу').toBeGreaterThan(0);
  });
});

describe('рынок особых карточек', () => {
  it('карточку можно выставить и купить: деньги и карточка переходят', () => {
    const seller = db.findOrCreateDevUser('card-seller@test.dev', 'Продавец');
    const buyer = db.findOrCreateDevUser('card-buyer@test.dev', 'Покупатель');

    // карточка продавцу
    const analyzer = 'analyzer-medium';
    db.addCard(seller.id, analyzer);
    expect(db.getCards(seller.id).find((c) => c.cardId === analyzer)?.count).toBe(1);

    const price = 30_000;
    const listed = db.listCard(seller.id, analyzer, price);
    expect(listed.ok, listed.error ?? '').toBe(true);
    // карточка ушла из руки в лот
    expect(db.getCards(seller.id).find((c) => c.cardId === analyzer)).toBeUndefined();

    const lot = db.getCardListings(buyer.id, analyzer).find((l) => l.sellerId === seller.id);
    expect(lot, 'лот виден покупателю').toBeDefined();
    expect(lot!.mine, 'лот не мой').toBe(false);

    const sellerCashBefore = db.getProfile(seller.id)!.cash;
    const buyerCashBefore = db.getProfile(buyer.id)!.cash;
    const bought = db.buyCard(buyer.id, lot!.id);
    expect(bought.ok, bought.error ?? '').toBe(true);

    expect(db.getCards(buyer.id).find((c) => c.cardId === analyzer)?.count, 'карточка у покупателя').toBe(1);
    expect(db.getProfile(buyer.id)!.cash, 'покупатель заплатил').toBeLessThan(buyerCashBefore);
    // продавец получает цену минус комиссия дома
    const sellerGain = db.getProfile(seller.id)!.cash - sellerCashBefore;
    expect(sellerGain).toBeGreaterThan(0);
    expect(sellerGain).toBeLessThanOrEqual(price);
  });

  it('нельзя купить свой лот и нельзя выставить чужую карточку', () => {
    const seller = db.findOrCreateDevUser('card-seller2@test.dev', 'Продавец 2');
    db.addCard(seller.id, 'analyzer-small');
    expect(db.listCard(seller.id, 'analyzer-small', 5_000).ok).toBe(true);
    const lot = db
      .getCardListings(seller.id, 'analyzer-small')
      .find((l) => l.sellerId === seller.id && l.mine)!;
    expect(db.buyCard(seller.id, lot.id).ok, 'свой лот не купить').toBe(false);

    const other = db.findOrCreateDevUser('card-other@test.dev', 'Другой');
    expect(db.listCard(other.id, 'analyzer-medium', 5_000).ok, 'нет карточки — нет лота').toBe(false);
  });

  it('снятый лот возвращает карточку владельцу', () => {
    const seller = db.findOrCreateDevUser('card-cancel@test.dev', 'Отменяющий');
    // у нового игрока уже есть стартовые анализаторы, поэтому считаем разницу
    const start = countOf(db.getCards(seller.id), 'analyzer-small');
    db.addCard(seller.id, 'analyzer-small');
    const listed = db.listCard(seller.id, 'analyzer-small', 7_000);
    expect(listed.ok, listed.error ?? '').toBe(true);
    expect(countOf(db.getCards(seller.id), 'analyzer-small'), 'копия ушла в лот').toBe(start);

    // ищем именно СВОЙ лот: у других продавцов может быть та же карточка дешевле
    const lot = db
      .getCardListings(seller.id, 'analyzer-small')
      .find((l) => l.sellerId === seller.id && l.mine)!;
    expect(lot, 'лот найден').toBeDefined();
    const cancelled = db.cancelCardListing(seller.id, lot.id);
    expect(cancelled.ok, cancelled.error ?? '').toBe(true);
    expect(countOf(db.getCards(seller.id), 'analyzer-small'), 'карточка вернулась').toBe(start + 1);
  });

  it('ботам доступны те же операции, что игрокам', () => {
    // Бот — обычный пользователь с флагом is_bot; карточки покупает тем же API
    const bot = db.findOrCreateBotUser('bot-card@test.dev', 'Бот Карточный', '', 'gambler');
    const botStart = countOf(db.getCards(bot.id), 'analyzer-small');
    db.addCard(bot.id, 'analyzer-small');
    const listed = db.listCard(bot.id, 'analyzer-small', 12_000);
    expect(listed.ok, 'бот может выставить карточку').toBe(true);

    const human = db.findOrCreateDevUser('card-human@test.dev', 'Человек');
    const humanStart = countOf(db.getCards(human.id), 'analyzer-small');
    const lot = db.getCardListings(human.id).find((l) => l.sellerId === bot.id && l.cardId === 'analyzer-small')!;
    expect(lot, 'лот бота виден человеку').toBeDefined();
    const bought = db.buyCard(human.id, lot.id);
    expect(bought.ok, bought.error ?? '').toBe(true);
    expect(countOf(db.getCards(human.id), 'analyzer-small'), 'человек получил карточку').toBe(humanStart + 1);
    expect(countOf(db.getCards(bot.id), 'analyzer-small'), 'у бота осталось на одну меньше').toBe(botStart);
  });
});

describe('особые карточки в каталоге', () => {
  it('анализаторы имеют силу и описание', () => {
    const analyzers = ['analyzer-small', 'analyzer-medium', 'analyzer-large'];
    for (const id of analyzers) {
      const def = findCard(id);
      expect(def, id + ' есть в каталоге').toBeDefined();
      expect(def!.setId).toBe('analyzers');
      expect(def!.power).toBeGreaterThan(0);
      expect(def!.reveals).toBeGreaterThan(0);
    }
  });
});
