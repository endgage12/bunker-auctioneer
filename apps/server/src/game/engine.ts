// Игровой движок «Раз, два, продано!» — «Корабль сокровищ»:
// вступительные ставки + один аукцион на весь стол из 5 раундов (как в NTE)
import {
  ANTE_MAX,
  ANTE_MIN,
  BETTING_SECONDS,
  BID_SECONDS,
  GRID_H,
  GRID_W,
  MULTIPLIERS,
  MULTIPLIER_PCT,
  PRIZE_ITEMS_PER_LOT_MAX,
  PRIZE_POOL_FACTOR,
  PRIZE_RARITY,
  REVEAL_FRACTIONS,
  REVEAL_SECONDS,
  RESOLVE_SECONDS,
  RARITY_LABEL,
  fmt,
  generateItem,
  itemsTotal,
} from '@auctioneer/shared';
import type {
  AuctionPhase,
  AuctionPublic,
  AuctionResult,
  FinalStanding,
  GamePhase,
  ItemInstance,
  LogEntry,
  PlayerPrivate,
  PrivateReveal,
  PublicBoard,
  PublicCell,
  PublicGame,
  PublicItem,
  PublicPlayer,
  Rarity,
} from '@auctioneer/shared';

export interface EnginePlayerSeed {
  id: string;
  name: string;
  avatar?: string;
  cash: number;
  inventory: ItemInstance[];
}

interface GPlayer {
  id: string;
  name: string;
  avatar?: string;
  startCash: number;
  /** номинал инвентаря на старте партии (для расчёта разницы) */
  startInventoryValue: number;
  cash: number;
  ante: number;
  /** всего вложено денег: вступительная ставка + оплата выигранных торгов */
  spent: number;
  online: boolean;
  passed: boolean;
  bid: number | null;
  inventory: ItemInstance[];
}

interface PlacedItem {
  it: ItemInstance;
  x: number;
  y: number;
  w: number;
  h: number;
  revealed: boolean;
}

interface AuctionInternal {
  round: number;
  multiplier: number;
  multiplierPct: number;
  phase: AuctionPhase;
  totalItems: number;
  revealedCount: number;
  revealedValue: number;
  rarityCounts: Partial<Record<Rarity, number>>;
  revealOrder: PlacedItem[];
  bids: { playerId: string; amount: number }[];
  result: AuctionResult | null;
  /** участники дополнительного 6-го раунда (лидеры ничьей) */
  tiedIds: string[];
}

export interface FinalReport {
  gameId: string;
  code: string;
  winnerId: string;
  standings: FinalStanding[];
  cash: Record<string, number>;
  startCash: Record<string, number>;
  inventories: Record<string, ItemInstance[]>;
  droppedItems: ItemInstance[];
  /** сколько денег ушло в банк дома (торги минус компенсации) */
  moneyToBank: number;
  /** сумма вступительных ставок */
  antePot: number;
  /** сумма вложений каждого игрока: вступительная ставка + оплата выигранных торгов */
  invested: Record<string, number>;
  /** разница состояния каждого игрока за партию: итог минус старт (наличные + инвентарь) */
  profit: Record<string, number>;
  /** предметы призового стола партии (для истории матчей) */
  prizeItems: (ItemInstance & { ownerId?: string })[];
}

export interface GameOptions {
  id: string;
  code: string;
  hostId: string;
  players: EnginePlayerSeed[];
  rng?: () => number;
  now?: () => number;
  bettingSeconds?: number;
  revealSeconds?: number;
  bidSeconds?: number;
  resolveSeconds?: number;
  /** активные бонусы сетов убежища по игрокам */
  playerBonuses?: Record<string, string[]>;
  onStateChange?: () => void;
  onFinished?: (report: FinalReport) => void;
}

export class Game {
  readonly id: string;
  readonly code: string;
  readonly hostId: string;

  private rng: () => number;
  private now: () => number;
  private bettingSeconds: number;
  private revealSeconds: number;
  private bidSeconds: number;
  private resolveSeconds: number;
  private bonuses: Record<string, string[]> = {};
  private privateReveals = new Map<string, PrivateReveal[]>();
  private privateHints = new Map<string, string[]>();
  private onStateChange?: () => void;
  private onFinished?: (report: FinalReport) => void;

  private players: GPlayer[] = [];
  private placed: PlacedItem[] = [];
  private dropped: ItemInstance[] = [];
  private auction: AuctionInternal | null = null;
  private log: LogEntry[] = [];
  private final: { standings: FinalStanding[]; winnerId: string } | null = null;
  private finished = false;
  private pot = 0;

  phase: GamePhase = 'betting';
  deadline = 0;
  /** сколько денег ушло в банк дома за торги — для проверки консервации */
  moneyToBank = 0;

  constructor(opts: GameOptions) {
    this.id = opts.id;
    this.code = opts.code;
    this.hostId = opts.hostId;
    this.rng = opts.rng ?? Math.random;
    this.now = opts.now ?? Date.now;
    this.bettingSeconds = opts.bettingSeconds ?? BETTING_SECONDS;
    this.revealSeconds = opts.revealSeconds ?? REVEAL_SECONDS;
    this.bidSeconds = opts.bidSeconds ?? BID_SECONDS;
    this.resolveSeconds = opts.resolveSeconds ?? RESOLVE_SECONDS;
    this.bonuses = opts.playerBonuses ?? {};
    this.onStateChange = opts.onStateChange;
    this.onFinished = opts.onFinished;
    this.players = opts.players.map((p) => ({
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      startCash: p.cash,
      startInventoryValue: itemsTotal(p.inventory),
      cash: p.cash,
      ante: 0,
      spent: 0,
      online: true,
      passed: false,
      bid: null,
      inventory: p.inventory.map((i) => ({ ...i })),
    }));
    this.deadline = this.now() + this.bettingSeconds * 1000;
    this.addLog('system', 'Сделайте вступительные ставки (от ' + fmt(ANTE_MIN) + ' до ' + fmt(ANTE_MAX) + '). Стол заполнится призами на 120% от банка ставок.');
  }

  // ---------- вспомогательные ----------

  private addLog(kind: LogEntry['kind'], text: string): void {
    this.log.push({ at: this.now(), text, kind });
    if (this.log.length > 150) this.log = this.log.slice(-150);
  }

  private getPlayer(id: string): GPlayer | undefined {
    return this.players.find((p) => p.id === id);
  }

  hasPlayer(id: string): boolean {
    return !!this.getPlayer(id);
  }

  get isFinished(): boolean {
    return this.finished;
  }

  markOnline(playerId: string, online: boolean): void {
    const p = this.getPlayer(playerId);
    if (p) p.online = online;
  }

  private shuffle<T>(arr: T[]): T[] {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  private overlapsPlaced(x: number, y: number, w: number, h: number): boolean {
    return this.placed.some((pl) => x < pl.x + pl.w && x + w > pl.x && y < pl.y + pl.h && y + h > pl.y);
  }

  private changed(): void {
    this.onStateChange?.();
  }

  // ---------- вступительные ставки ----------

  submitAnte(playerId: string, amount: number): string | null {
    if (this.phase !== 'betting') return 'Ставки сейчас не принимаются';
    const p = this.getPlayer(playerId);
    if (!p) return 'Игрок не найден';
    amount = Math.floor(amount);
    if (!Number.isFinite(amount) || amount < 1) return 'Ставка должна быть больше нуля';
    if (amount > ANTE_MAX) return 'Максимальная вступительная ставка — ' + fmt(ANTE_MAX);
    if (amount > p.cash) return 'Недостаточно средств';
    p.ante = amount;
    this.addLog('system', p.name + ' поставил(а) вступительную ставку ' + fmt(amount));
    if (this.players.every((q) => q.ante > 0)) this.deadline = 0;
    this.changed();
    return null;
  }

  tick(): void {
    if (this.finished) return;
    if (this.now() >= this.deadline) this.advance();
  }

  advance(): void {
    if (this.finished) return;
    if (this.phase === 'betting') {
      this.lockBetting();
      return;
    }
    if (this.phase === 'auction' && this.auction) {
      const a = this.auction;
      if (a.phase === 'reveal') this.beginBid();
      else if (a.phase === 'bid') this.resolveBids();
      else if (a.phase === 'resolve') {
        this.auction = null;
        this.finishGame();
      }
    }
  }

  private lockBetting(): void {
    let pot = 0;
    for (const p of this.players) {
      let ante = p.ante;
      if (ante <= 0) ante = Math.min(ANTE_MIN, p.cash);
      p.ante = ante;
      p.cash -= ante;
      p.spent += ante;
      pot += ante;
    }
    this.pot = pot;
    this.addLog('system', 'Ставки приняты. Банк партии: ' + fmt(pot));
    this.buildTable(pot);
    this.phase = 'auction';
    this.addLog('system', 'Стол заполнен и запечатан. «Корабль сокровищ» готов к торгам!');
    this.startAuction();
    this.changed();
  }

  // ---------- стол ----------

  private buildTable(pot: number): void {
    const P = this.players.length;
    const target = Math.round((pot * PRIZE_POOL_FACTOR) / P);
    const lots: ItemInstance[][] = this.players.map(() => []);
    let candidates = lots.map((_, i) => i);
    let guard = 0;
    while (candidates.length > 0 && guard++ < 300) {
      const i = candidates.reduce(
        (best, ci) => (itemsTotal(lots[ci]) < itemsTotal(lots[best]) ? ci : best),
        candidates[0],
      );
      if (itemsTotal(lots[i]) >= target) {
        candidates = candidates.filter((c) => c !== i);
        continue;
      }
      lots[i].push(generateItem(this.rng, { rarityWeights: PRIZE_RARITY }));
      if (lots[i].length >= PRIZE_ITEMS_PER_LOT_MAX) candidates = candidates.filter((c) => c !== i);
    }
    for (const lot of lots) {
      for (const item of lot) {
        const placed = this.tryPlaceItem(item);
        if (!placed) this.dropped.push(item);
      }
    }
  }

  private tryPlaceItem(item: ItemInstance): boolean {
    for (let attempt = 0; attempt < 400; attempt++) {
      const w = this.rng() < 0.5 ? item.w : item.h;
      const h = w === item.w ? item.h : item.w;
      const x = Math.floor(this.rng() * (GRID_W - w + 1));
      const y = Math.floor(this.rng() * (GRID_H - h + 1));
      if (x < 0 || y < 0) continue;
      if (this.overlapsPlaced(x, y, w, h)) continue;
      this.placed.push({ it: item, x, y, w, h, revealed: false });
      return true;
    }
    return false;
  }

  // ---------- аукцион «Корабль сокровищ» ----------

  private startAuction(): void {
    const placed = this.placed;
    if (placed.length === 0) {
      this.finishGame();
      return;
    }
    const rarityCounts: Partial<Record<Rarity, number>> = {};
    for (const pl of placed) rarityCounts[pl.it.rarity] = (rarityCounts[pl.it.rarity] ?? 0) + 1;
    this.auction = {
      round: 1,
      multiplier: MULTIPLIERS[0],
      multiplierPct: MULTIPLIER_PCT[0],
      phase: 'reveal',
      totalItems: placed.length,
      revealedCount: 0,
      revealedValue: 0,
      rarityCounts,
      revealOrder: this.shuffle(placed.slice()),
      bids: [],
      result: null,
      tiedIds: [],
    };
    for (const p of this.players) {
      p.passed = false;
      p.bid = null;
    }
    this.revealForRound(1);
    this.grantPrivateBonuses();
    this.deadline = this.now() + this.revealSeconds * 1000;
    this.addLog('reveal', 'Аукцион «Корабль сокровищ»: 5 раундов, победитель забирает все предметы стола');
    this.changed();
  }

  /** Личные бонусы сетов: +1 раскрытие и «слухи» о самом дорогом скрытом предмете */
  private grantPrivateBonuses(): void {
    const a = this.auction;
    if (!a) return;
    this.privateReveals.clear();
    this.privateHints.clear();
    for (const p of this.players) {
      const b = this.bonuses[p.id] ?? [];
      const hidden = a.revealOrder.filter((pl) => !pl.revealed);
      if (b.includes('reveal_plus_one') && hidden.length > 0) {
        const pick = hidden[Math.floor(this.rng() * hidden.length)];
        this.privateReveals.set(p.id, [
          {
            itemId: pick.it.id,
            name: pick.it.name,
            rarity: pick.it.rarity,
            value: pick.it.value,
            w: pick.it.w,
            h: pick.it.h,
          },
        ]);
      }
      if (b.includes('dragon_hint') && hidden.length > 0) {
        const best = hidden.slice().sort((x, y) => y.it.value - x.it.value)[0];
        const hint = 'Слух: на столе скрыт предмет редкости «' + RARITY_LABEL[best.it.rarity] + '»';
        this.privateHints.set(p.id, [hint]);
      }
    }
  }

  /** Персональная информация для конкретного игрока (только для его сокета) */
  personalSnapshot(playerId: string): PlayerPrivate | null {
    const reveals = this.privateReveals.get(playerId) ?? [];
    const hints = this.privateHints.get(playerId) ?? [];
    if (reveals.length === 0 && hints.length === 0) return null;
    return { reveals: reveals.slice(), hints: hints.slice() };
  }

  private revealForRound(round: number): void {
    const a = this.auction;
    if (!a) return;
    const n = a.totalItems;
    let target = round <= 4 ? Math.max(1, Math.ceil(n * REVEAL_FRACTIONS[round - 1])) : n;
    target = Math.min(target, n);
    while (a.revealedCount < target) {
      const pl = a.revealOrder[a.revealedCount];
      pl.revealed = true;
      a.revealedCount++;
    }
    a.revealedValue = itemsTotal(a.revealOrder.slice(0, a.revealedCount).map((pl) => pl.it));
    this.addLog(
      'reveal',
      'Раунд ' + round + ': открыто предметов ' + a.revealedCount + ' из ' + n + ', сумма открытых: ' + fmt(a.revealedValue),
    );
  }

  private beginBid(): void {
    const a = this.auction;
    if (!a) return;
    a.phase = 'bid';
    const activeIds = a.round === 6 ? a.tiedIds : this.players.map((p) => p.id);
    for (const p of this.players) {
      if (activeIds.includes(p.id)) {
        p.passed = false;
        p.bid = null;
      } else {
        p.passed = true;
        p.bid = null;
      }
    }
    const extra = this.players.some((p) => (this.bonuses[p.id] ?? []).includes('bid_time_bonus')) ? 10 : 0;
    this.deadline = this.now() + (this.bidSeconds + extra) * 1000;
    if (a.round === 6) {
      this.addLog('bid', 'Дополнительный 6-й раунд: участвуют только лидеры прошлого раунда');
    } else {
      this.addLog('bid', 'Раунд ' + a.round + ' — слепые ставки! (победа при ставке ≥ ×' + a.multiplier + ' от второй)');
    }
    this.changed();
  }

  submitBid(playerId: string, amount: number): string | null {
    if (this.phase !== 'auction' || !this.auction) return 'Сейчас нет торгов';
    const a = this.auction;
    if (a.phase !== 'bid') return 'Ставки сейчас не принимаются';
    const p = this.getPlayer(playerId);
    if (!p) return 'Игрок не найден';
    if (p.passed) return 'Вы не участвуете в этом раунде';
    amount = Math.floor(amount);
    if (!Number.isFinite(amount) || amount < 0 || amount > p.cash) return 'Некорректная сумма ставки';
    p.bid = amount;
    if (amount === 0) {
      p.passed = true;
      this.addLog('bid', p.name + ' пасует');
    } else {
      this.addLog('bid', p.name + ' сделал(а) ставку');
    }
    const active = this.players.filter((q) => !q.passed);
    if (active.length > 0 && active.every((q) => q.bid !== null)) this.deadline = 0;
    this.changed();
    return null;
  }

  private resolveBids(): void {
    const a = this.auction;
    if (!a) return;
    a.bids = this.players.map((p) => ({ playerId: p.id, amount: p.bid ?? 0 }));
    const positives = this.players
      .filter((p) => !p.passed)
      .map((p) => ({ id: p.id, amount: p.bid ?? 0 }))
      .filter((b) => b.amount > 0)
      .sort((x, y) => y.amount - x.amount);
    if (positives.length === 0) {
      this.noWinner();
      return;
    }
    const max = positives[0].amount;
    const tied = positives.filter((b) => b.amount === max);
    if (tied.length > 1) {
      if (a.round === 6) {
        this.voidSale();
      } else if (a.round === 5) {
        this.extraRound(tied.map((b) => b.id));
      } else {
        this.nextRound();
      }
      return;
    }
    const second = positives.length > 1 ? positives[1].amount : 0;
    const winnerId = positives[0].id;
    if (a.round >= 5 || max * 100 >= a.multiplierPct * second) {
      this.applyWin(winnerId, max);
    } else {
      this.nextRound();
    }
  }

  private noWinner(): void {
    const a = this.auction;
    if (!a) return;
    if (a.round === 6) {
      this.voidSale();
      return;
    }
    if (a.round === 5) {
      this.extraRound([]);
      return;
    }
    this.nextRound();
  }

  private nextRound(): void {
    const a = this.auction;
    if (!a) return;
    a.round += 1;
    a.multiplier = MULTIPLIERS[a.round - 1] ?? 1;
    a.multiplierPct = MULTIPLIER_PCT[a.round - 1] ?? 100;
    a.phase = 'reveal';
    this.revealForRound(a.round);
    this.deadline = this.now() + this.revealSeconds * 1000;
    this.addLog('system', 'Раунд ' + a.round + ': условие победы не выполнено, торги продолжаются');
    this.changed();
  }

  private extraRound(tiedIds: string[]): void {
    const a = this.auction;
    if (!a) return;
    a.round = 6;
    a.multiplier = 1;
    a.multiplierPct = 100;
    a.tiedIds = tiedIds.length > 0 ? tiedIds : this.players.filter((p) => !p.passed).map((p) => p.id);
    a.phase = 'reveal';
    this.deadline = this.now() + this.revealSeconds * 1000;
    this.addLog('result', 'Ничья в 5-м раунде! Дополнительный 6-й раунд. Если ставки снова совпадут — стол не достанется никому.');
    this.changed();
  }

  private applyWin(winnerId: string, price: number): void {
    const a = this.auction;
    if (!a) return;
    const winner = this.getPlayer(winnerId);
    if (!winner) return;
    this.revealAll();
    winner.cash -= price;
    winner.spent += price;
    const totalValue = itemsTotal(this.placed.map((pl) => pl.it));
    // предметы остаются на столе (для финального экрана), но переходят победителю
    for (const pl of this.placed) winner.inventory.push(pl.it);
    // компенсация как в NTE: переплата возвращается остальным из банка
    let compensation = 0;
    const losers = this.players.filter((p) => p.id !== winnerId);
    if (price > totalValue && losers.length > 0) {
      const per = Math.floor((price - totalValue) / losers.length);
      if (per > 0) {
        for (const l of losers) l.cash += per;
        compensation = per * losers.length;
      }
    }
    this.moneyToBank += price - compensation;
    this.addLog('result', 'Победитель: ' + winner.name + ' за ' + fmt(price) + ' — забирает все предметы стола');
    if (compensation > 0) {
      this.addLog('result', 'Переплата: банк выплатил компенсацию ' + fmt(compensation) + ' остальным игрокам');
    }
    a.result = { winnerId, price, compensation };
    a.phase = 'resolve';
    this.deadline = this.now() + this.resolveSeconds * 1000;
    this.changed();
  }

  private voidSale(): void {
    const a = this.auction;
    if (!a) return;
    this.revealAll();
    for (const pl of this.placed) this.dropped.push(pl.it);
    a.result = { voided: true };
    a.phase = 'resolve';
    this.deadline = this.now() + this.resolveSeconds * 1000;
    this.addLog('result', 'Ставки снова совпали — аукцион завершился без продажи, предметы сгорели');
    this.changed();
  }

  // ---------- финал ----------

  /**
   * Финальное раскрытие: перевернуть все оставшиеся скрытыми предметы стола.
   * Вызывается при определении исхода аукциона и в финале (идемпотентно):
   * даже если игра закончилась раньше 4-го раунда, игроки увидят весь стол.
   */
  private revealAll(): void {
    if (this.placed.every((pl) => pl.revealed)) return;
    for (const pl of this.placed) pl.revealed = true;
    const total = itemsTotal(this.placed.map((pl) => pl.it));
    const a = this.auction;
    if (a) {
      a.revealedCount = a.totalItems;
      a.revealedValue = total;
    }
    this.addLog('reveal', 'Стол раскрыт полностью: ' + this.placed.length + ' предметов на ' + fmt(total));
  }

  private finishGame(): void {
    this.revealAll();
    const standings: FinalStanding[] = this.players.map((p) => {
      const inventoryValue = itemsTotal(p.inventory);
      return { playerId: p.id, cash: p.cash, inventoryValue, total: p.cash + inventoryValue, place: 0 };
    });
    standings.sort((a, b) => b.total - a.total || b.cash - a.cash || a.playerId.localeCompare(b.playerId));
    standings.forEach((s, i) => {
      s.place = i + 1;
    });
    const winnerId = standings[0].playerId;
    const winner = this.getPlayer(winnerId);
    this.final = { standings, winnerId };
    this.phase = 'finished';
    this.finished = true;
    this.deadline = 0;
    this.addLog('result', 'Игра окончена! Победитель: ' + (winner?.name ?? '—'));
    this.changed();
    this.onFinished?.(this.buildReport());
  }

  private buildReport(): FinalReport {
    const standings: FinalStanding[] = this.players.map((p) => {
      const inventoryValue = itemsTotal(p.inventory);
      return { playerId: p.id, cash: p.cash, inventoryValue, total: p.cash + inventoryValue, place: 0 };
    });
    standings.sort((a, b) => b.total - a.total || b.cash - a.cash || a.playerId.localeCompare(b.playerId));
    standings.forEach((s, i) => {
      s.place = i + 1;
    });
    return {
      gameId: this.id,
      code: this.code,
      winnerId: standings[0].playerId,
      standings,
      cash: Object.fromEntries(this.players.map((p) => [p.id, p.cash])),
      startCash: Object.fromEntries(this.players.map((p) => [p.id, p.startCash])),
      inventories: Object.fromEntries(this.players.map((p) => [p.id, p.inventory])),
      droppedItems: this.dropped,
      moneyToBank: this.moneyToBank,
      antePot: this.pot,
      invested: Object.fromEntries(this.players.map((p) => [p.id, p.spent])),
      profit: Object.fromEntries(
        this.players.map((p) => [p.id, p.cash + itemsTotal(p.inventory) - p.startCash - p.startInventoryValue]),
      ),
      prizeItems: this.placed.map((pl) => ({
        ...pl.it,
        // победитель аукциона получил предмет в инвентарь; сгоревшие — никому
        ownerId: this.players.find((p) => p.inventory.some((i) => i.id === pl.it.id))?.id,
      })),
    };
  }

  // ---------- снимок состояния ----------

  snapshot(): PublicGame {
    const players: PublicPlayer[] = this.players.map((p) => ({
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      cash: p.cash,
      startCash: p.startCash,
      ante: p.ante,
      online: p.online,
      passed: p.passed,
      bidPlaced: p.bid !== null,
      inventoryValue: itemsTotal(p.inventory),
      isHost: p.id === this.hostId,
      ready: false,
    }));

    const items: PublicItem[] = [];
    for (const pl of this.placed) items.push(this.publicItem(pl));

    let auction: AuctionPublic | null = null;
    if (this.auction) {
      const a = this.auction;
      auction = {
        board: 'prize',
        lotIndex: 0,
        round: a.round,
        multiplier: a.multiplier,
        phase: a.phase,
        totalItems: a.totalItems,
        revealedCount: a.revealedCount,
        revealedValue: a.revealedValue,
        rarityCounts: { ...a.rarityCounts },
        bids: a.phase === 'resolve' ? a.bids : undefined,
        result: a.phase === 'resolve' ? a.result ?? undefined : undefined,
      };
    }

    return {
      id: this.id,
      code: this.code,
      phase: this.phase,
      players,
      board: this.boardSnapshot(),
      items,
      auction,
      deadline: this.deadline,
      log: this.log.slice(-100),
      final: this.final ?? undefined,
    };
  }

  private publicItem(pl: PlacedItem): PublicItem {
    const base: PublicItem = {
      id: pl.it.id,
      board: 'prize',
      lot: 0,
      revealed: pl.revealed,
    };
    if (pl.revealed) {
      base.x = pl.x;
      base.y = pl.y;
      base.w = pl.w;
      base.h = pl.h;
      base.name = pl.it.name;
      base.rarity = pl.it.rarity;
      base.value = pl.it.value;
    }
    return base;
  }

  private boardSnapshot(): PublicBoard {
    const cells: PublicCell[] = Array.from({ length: GRID_W * GRID_H }, () => ({ kind: 'empty' as const }));
    for (const pl of this.placed) {
      for (let dy = 0; dy < pl.h; dy++) {
        for (let dx = 0; dx < pl.w; dx++) {
          const idx = (pl.y + dy) * GRID_W + (pl.x + dx);
          cells[idx] = pl.revealed ? { kind: 'item', itemId: pl.it.id } : { kind: 'closed' };
        }
      }
    }
    return { w: GRID_W, h: GRID_H, cells, lots: [] };
  }

  /** Внутреннее состояние — только для тестов */
  debug() {
    return {
      players: this.players,
      placed: this.placed,
      dropped: this.dropped,
      moneyToBank: this.moneyToBank,
      pot: this.pot,
    };
  }
}
