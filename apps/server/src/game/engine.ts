// Игровой движок «Раз, два, продано!» — «Корабль сокровищ»:
// вступительные ставки + один аукцион на весь стол из 5 раундов (как в NTE)
import {
  COMPENSATION_FLOOR_SHARE,
  streakBonus,
  COMPENSATION_RATE,
  BETTING_SECONDS,
  BID_SECONDS,
  GRID_H,
  GRID_W,
  MULTIPLIERS,
  MULTIPLIER_PCT,
  PRIZE_RARITY,
  TABLE_FILL_ABS_MIN,
  TABLE_FILL_MAX,
  TABLE_FILL_MIN,
  REVEAL_FRACTIONS,
  REVEAL_SECONDS,
  RESOLVE_SECONDS,
  RARITY_LABEL,
  fmt,
  generateItem,
  itemsTotal,
  instanceFromDef,
  ITEM_CATALOG,
  RARITY_ORDER,
  DEFAULT_TIER,
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
  RarityHint,
  TierDef,
} from '@auctioneer/shared';


/**
 * Минимальная доля ставки, которая остаётся в банке и не может уйти
 * проигравшим в виде компенсации. Гарантирует, что переплата никогда не
 * становится выгодной: игроки не могут «выкупить» стол дешевле его стоимости.
 */
function compensationFloor(_tableValue: number, price: number): number {
  return Math.round(price * COMPENSATION_FLOOR_SHARE);
}

/** Самая низкая цена за клетку в каталоге (белые предметы) — нижняя граница плотности стола */
const CHEAPEST_PER_CELL = 1_379;

/** Порог плотности ценности (валюты на клетку), выше которого стол добирается дорогими редкостями */
const EXPENSIVE_DENSITY = 26_000;

/** Веса редкостей для «дорогого» стола: редко белые/зелёные, чаще жёлтые/золотые/красные */
const EXPENSIVE_RARITY: Record<Rarity, number> = {
  white: 2, green: 8, blue: 12, purple: 16, yellow: 22, gold: 24, red: 16,
};

/**
 * Средняя ценность одной клетки по редкостям (считается один раз из каталога).
 * Белый ≈ 1.4к/клетка, красный ≈ 134к/клетка — эти числа и позволяют собирать
 * стол заданной стоимости, а не «как получится».
 */
const RARITY_DENSITY: Record<Rarity, number> = (() => {
  const out = {} as Record<Rarity, number>;
  for (const rarity of RARITY_ORDER) {
    const pool = ITEM_CATALOG.filter((d) => d.rarity === rarity);
    if (pool.length === 0) {
      out[rarity] = 1;
      continue;
    }
    const value = pool.reduce((s, d) => s + d.value, 0) / pool.length;
    const cells = pool.reduce((s, d) => s + Math.max(1, d.w * d.h), 0) / pool.length;
    out[rarity] = Math.max(1, value / cells);
  }
  return out;
})();

/** Веса редкостей по близости их «цены за клетку» к требуемой плотности */
function rarityWeightsFor(densityNeed: number): Record<Rarity, number> {
  const out = {} as Record<Rarity, number>;
  for (const rarity of RARITY_ORDER) {
    const d = RARITY_DENSITY[rarity];
    // логарифмическое расстояние: 1 — идеальное совпадение
    const closeness = Math.min(d, densityNeed) / Math.max(d, densityNeed);
    out[rarity] = 0.02 + closeness * closeness * closeness;
  }
  return out;
}

export interface EnginePlayerSeed {
  id: string;
  name: string;
  avatar?: string;
  cash: number;
  inventory: ItemInstance[];
  /** текущая серия побед подряд — за неё начисляется надбавка к призовым */
  streak?: number;
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
  /** серия побед подряд на входе в партию */
  streak: number;
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
  /**
   * Зал казино: фиксированная плата за вход и предопределённая ценность стола.
   * Стол разыгрывается движком ДО начала партии и не зависит от того, сколько
   * внесли игроки, — это и делает игру азартной, а не «аукционом взносов».
   * По умолчанию — медный зал (удобно для тестов).
   */
  tier?: TierDef;
  rng?: () => number;
  now?: () => number;
  bettingSeconds?: number;
  revealSeconds?: number;
  bidSeconds?: number;
  resolveSeconds?: number;
  /** активные бонусы сетов убежища по игрокам */
  playerBonuses?: Record<string, string[]>;
  /**
   * Только для тестов: заранее заданный призовой стол вместо случайного.
   * Позволяет проверить расчёт партии на точных числах.
   */
  tableItems?: ItemInstance[];
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
  /** зал казино: плата за вход и диапазон ценности стола */
  readonly tier: TierDef;
  /** предопределённая (разыгранная заранее) ценность стола */
  /**
   * Ценность стола. Разыгрывается залом ДО партии и служит целью при сборке,
   * а после сборки фиксируется по фактической сумме предметов — иначе игрок
   * видит в итогах одно число, а получает предметы на другое.
   */
  tableValue: number;
  /**
   * Исходная ценность, разыгранная залом до партии (цель сборки).
   * tableValue после сборки равен фактической сумме предметов, поэтому
   * для проверок нужна и цель.
   */
  rolledTableValue: number;
  /** тестовый стол (если задан — случайная генерация не используется) */
  private tableOverride: ItemInstance[] | null;
  private privateReveals = new Map<string, PrivateReveal[]>();
  private privateHints = new Map<string, string[]>();
  /** личные подсказки о редкости скрытых предметов (карточки-анализаторы) */
  private rarityHints = new Map<string, RarityHint[]>();
  private onStateChange?: () => void;
  private onFinished?: (report: FinalReport) => void;

  private players: GPlayer[] = [];
  private placed: PlacedItem[] = [];
  private dropped: ItemInstance[] = [];
  private auction: AuctionInternal | null = null;
  private log: LogEntry[] = [];
  private final: NonNullable<PublicGame['final']> | null = null;
  /** итоги последних торгов: нужны финальному экрану после сброса аукциона */
  private finalAuction: NonNullable<NonNullable<PublicGame['final']>['auction']> | null = null;
  private finished = false;
  private pot = 0;

  phase: GamePhase = 'ready';
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
    this.tier = opts.tier ?? DEFAULT_TIER;
    this.tableOverride = opts.tableItems ?? null;
    // Ценность стола разыгрывается ЗАРАНЕЕ и фиксируется до начала партии.
    // Смещение к нижней границе: дорогие столы — редкость и потому желанны.
    this.tableValue = this.rollTableValue();
    this.rolledTableValue = this.tableValue;
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
      streak: p.streak ?? 0,
      inventory: p.inventory.map((i) => ({ ...i })),
    }));
    // стол формируется и запечатывается ДО начала торгов
    this.buildTable();
    this.deadline = this.now() + this.bettingSeconds * 1000;
    this.addLog(
      'system',
      this.tier.name + ': плата за вход ' + fmt(this.tier.entry) +
        '. Стол запечатан — его ценность определена заранее.',
    );
    this.addLog('system', 'Подтвердите вход, чтобы начать торги.');
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

  /**
   * Короткая реплика игрока в лог партии. Текст приходит от клиента, поэтому
   * ограничиваем длину и вырезаем переводы строк — это «чат», а не команды.
   */
  say(playerId: string, text: string): string | null {
    if (this.finished) return 'Партия завершена';
    const p = this.getPlayer(playerId);
    if (!p) return 'Игрок не найден';
    const clean = String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
    if (!clean) return 'Пустое сообщение';
    this.addLog('chat', p.name + ': ' + clean);
    this.changed();
    return null;
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

  /**
   * Подтверждение входа в партию. Сумму выбирать нельзя: плата за вход
   * фиксирована залом, а ценность стола уже разыграна заранее.
   */
  confirmEntry(playerId: string): string | null {
    if (this.phase !== 'ready') return 'Вход сейчас недоступен';
    const p = this.getPlayer(playerId);
    if (!p) return 'Игрок не найден';
    if (p.ante > 0) return 'Вход уже подтверждён';
    if (p.cash < this.tier.entry) {
      return 'Нужно ' + fmt(this.tier.entry) + ' для входа в ' + this.tier.name;
    }
    p.ante = this.tier.entry;
    this.addLog('system', p.name + ' внёс(ла) вход ' + fmt(this.tier.entry));
    // как только все подтвердили — сразу начинаем торги
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
    if (this.phase === 'ready') {
      this.lockEntries();
      return;
    }
    if (this.phase === 'auction' && this.auction) {
      const a = this.auction;
      if (a.phase === 'reveal') this.beginBid();
      else if (a.phase === 'bid') this.resolveBids();
      else if (a.phase === 'resolve') {
        // Сначала подводим итоги (им нужны итоги торгов), потом убираем аукцион
        this.finishGame();
        this.auction = null;
      }
    }
  }

  /**
   * Закрытие входа: со всех списывается фиксированная плата за вход.
   * Кто не подтвердил вовремя — платит всё равно (он уже в партии), а если
   * денег не хватает, играет за счёт минимального входа из остатка.
   */
  private lockEntries(): void {
    let pot = 0;
    for (const p of this.players) {
      const entry = Math.min(this.tier.entry, Math.max(0, p.cash));
      p.ante = entry;
      p.cash -= entry;
      p.spent += entry;
      pot += entry;
    }
    this.pot = pot;
    this.addLog('system', 'Вход закрыт. Банк зала: ' + fmt(pot));
    this.phase = 'auction';
    this.addLog('system', '«Корабль сокровищ» готов к торгам!');
    this.startAuction();
    this.changed();
  }

  // ---------- стол ----------

  /**
   * Стол заполняется предметами до случайной суммарной стоимости
   * в диапазоне TABLE_VALUE_MIN (300 000) .. TABLE_VALUE_MAX (9 000 000),
   * при этом занято не менее TABLE_FILL_MIN (50%) и не более
   * TABLE_FILL_MAX (95%) клеток поля. Предметы кладутся вплотную друг
   * к другу от правого верхнего угла. Когда требуемая плотность ценности
   * высока, редкости смещаются в сторону дорогих предметов.
   */
  /**
   * Розыгрыш ценности стола. Смещение к нижней границе: дорогие столы —
   * редкость и потому желанны.
   */
  private rollTableValue(): number {
    return Math.round(
      this.tier.tableMin + (this.tier.tableMax - this.tier.tableMin) * Math.pow(this.rng(), 1.7),
    );
  }

  /**
   * Сборка стола. Предметы дискретны, поэтому фактическая сумма может не дотянуть
   * до разыгранной цели — а игроку обещан стол в границах зала. Если не дотянули,
   * пересобираем с новой целью (не больше трёх попыток, дальше берём лучшее).
   */
  private buildTable(): void {
    if (this.tableOverride || Number(process.env.GAME_TABLE_VALUE_OVERRIDE ?? 0) > 0) {
      this.buildTableOnce();
      // у оверрайда ценность уже задана извне — фиксируем её как есть
      if (this.tableOverride) {
        this.tableValue = itemsTotal(this.placed.map((pl) => pl.it));
        this.rolledTableValue = this.tableValue;
      }
      return;
    }
    let best = 0;
    for (let attempt = 0; attempt < 3; attempt++) {
      this.placed = [];
      this.dropped = [];
      this.buildTableOnce();
      const placed = itemsTotal(this.placed.map((pl) => pl.it));
      if (placed >= this.tier.tableMin) return; // стол в границах зала
      if (placed > best) best = placed;
      if (attempt < 2) {
        this.tableValue = this.rollTableValue();
        this.rolledTableValue = this.tableValue;
      }
    }
    // трижды не дотянули — оставляем лучший результат, ценность по факту
    this.tableValue = best;
  }

  private buildTableOnce(): void {
    // тестовый оверрайд: стол задан снаружи
    if (this.tableOverride && this.tableOverride.length > 0) {
      for (const it of this.tableOverride) {
        if (!this.tryPlaceItem({ ...it })) this.dropped.push({ ...it });
      }
      this.finalizeTableValue();
      return;
    }
    // Тестовый оверрайд стоимости: позволяет интеграционным тестам получить
    // заранее известную сумму стола (например, чтобы проверить переплату).
    const forcedValue = Number(process.env.GAME_TABLE_VALUE_OVERRIDE ?? 0);
    if (Number.isFinite(forcedValue) && forcedValue > 0) {
      let placedValue = 0;
      let guardLeft = 600;
      while (placedValue < forcedValue && guardLeft-- > 0) {
        const remaining = forcedValue - placedValue;
        const item = generateItem(this.rng, { rarityWeights: PRIZE_RARITY });
        // подгоняем предмет под остаток, чтобы итог совпал точно
        const value = Math.max(1, Math.min(remaining, item.value));
        const fitted = { ...item, value };
        if (this.tryPlaceItem(fitted)) placedValue += value;
      }
      if (placedValue > 0) {
        // Ценность стола для игрока и для интерфейса должна совпадать
        // с тем, что реально лежит на столе.
        this.tableValue = placedValue;
        this.rolledTableValue = placedValue;
        return;
      }
    }
    const totalCells = GRID_W * GRID_H;
    // Ценность стола ПРЕДОПРЕДЕЛЕНА залом и разыграна до начала партии:
    // игроки не влияют на неё своими взносами.
    const target = this.tableValue;
    const absMin = Math.floor(totalCells * TABLE_FILL_ABS_MIN);
    const softMin = Math.floor(totalCells * TABLE_FILL_MIN);
    const maxCover = Math.floor(totalCells * TABLE_FILL_MAX);
    // Покрытие ограничено ценностью: чтобы набрать дешёвый стол, приходится
    // брать мелкие предметы, и 50% клеток может не хватить. Поэтому для дешёвых
    // столов допускаем меньшее покрытие (до TABLE_FILL_ABS_MIN).
    // Сколько клеток можно занять, чтобы не выйти за ценность: даже самыми
    // дешёвыми предметами дороже этой площади стол не собрать.
    const maxCellsForValue = Math.max(absMin, Math.floor(target / CHEAPEST_PER_CELL));
    const minCover = Math.max(absMin, Math.min(softMin, maxCellsForValue));
    const hardCover = Math.min(maxCover, maxCellsForValue);
    const coverTarget = Math.min(
      minCover + Math.floor(Math.max(0, hardCover - minCover) * this.rng()),
      hardCover,
    );

    // Набираем стол так, чтобы уложиться И в целевую стоимость, И в площадь.
    // Ключ — ценность на клетку: она подсказывает, какие редкости брать
    // (белый ≈1.4к/клетка ... красный ≈134к/клетка). Раньше стоимость цели
    // игнорировалась: цикл работал «пока не закрыто 50% клеток», и любой стол
    // выходил на ~3.7 млн независимо от цели.
    //
    // Плотность = сколько валюты должно приходиться на клетку стола. Из неё
    // получаем бюджет клеток для каждой редкости: дорогие предметы «съедают»
    // меньше места, дешёвые — больше. Так дешёвый стол становится плотной
    // горой мелочи, а дорогой — несколькими ценными вещами.
    const density = target / Math.max(1, coverTarget);
    const weights = rarityWeightsFor(density);
    // Долю клеток считаем не по «популярности» редкости, а по её вкладу в
    // ценность: клетки × цена за клетку. Иначе дорогие редкости получают
    // слишком много места и стол выходит вдвое дороже цели.
    const shares = RARITY_ORDER.map((r) => weights[r] * RARITY_DENSITY[r]);
    const shareSum = shares.reduce((a, b) => a + b, 0) || 1;
    const budget: Record<Rarity, number> = {} as Record<Rarity, number>;
    let assigned = 0;
    for (let i = 0; i < RARITY_ORDER.length; i++) {
      const r = RARITY_ORDER[i];
      if (i === RARITY_ORDER.length - 1) {
        budget[r] = Math.max(0, coverTarget - assigned);
      } else {
        budget[r] = Math.floor((shares[i] / shareSum) * coverTarget);
        assigned += budget[r];
      }
    }

    // Собираем пул так, чтобы его СУММА сразу равнялась цели: каждой редкости
    // достаётся доля денег (не клеток!), и внутри неё мы набираем предметы,
    // пока доля не выбрана. Площадь выходит производной — это и даёт нужную
    // плотность без подгонки.
    const items: ItemInstance[] = [];
    // Упаковка даёт систематический перебор (номиналы дискретны), поэтому
    // планируем пул чуть ниже цели — тогда фактическая сумма садится на неё.
    const PACKING_OVERSHOOT = 0.85;
    const valuePlan = RARITY_ORDER.map((_, i) => (shares[i] / shareSum) * target * PACKING_OVERSHOOT);
    for (let ri = 0; ri < RARITY_ORDER.length; ri++) {
      const rarity = RARITY_ORDER[ri];
      const pool = ITEM_CATALOG.filter((d) => d.rarity === rarity);
      if (pool.length === 0) continue;
      let given = 0;
      let guard = 0;
      const plan = valuePlan[ri];
      while (given < plan && guard++ < 400) {
        const def = pool[Math.floor(this.rng() * pool.length)];
        const remaining = plan - given;
        // Собираем долю редкости ТОЧНО: если предмет не вписывается в остаток,
        // берём более дешёвый, а в конце подрезаем номинал под остаток. Иначе
        // фактическая сумма стола уходила за верхнюю границу зала.
        let chosen = def;
        if (def.value > remaining) {
          const affordable = pool.filter((d) => d.value <= remaining);
          if (affordable.length === 0) {
            chosen = { ...def, value: Math.max(1, Math.round(remaining)) } as typeof def;
            const fitted = { ...instanceFromDef(chosen), value: Math.max(1, Math.round(remaining)) };
            items.push(fitted);
            given += fitted.value;
            break;
          }
          chosen = affordable[Math.floor(this.rng() * affordable.length)];
        }
        const inst = instanceFromDef(chosen);
        items.push(inst);
        given += inst.value;
      }
    }

    // Укладываем по строгому бюджету: ни ценность, ни площадь не выходят за
    // цель. Дорогие предметы идут первыми (место ограничено), но если предмет
    // не влезает в остаток ценности — пропускаем и пробуем более дешёвый.
    // Пул сбалансирован заранее, поэтому укладываем вразнобой: жадный выбор
    // «дорогие вперёд» съедал бюджет двумя предметами и оставлял стол пустым.
    const cellBudget = Math.max(coverTarget, hardCover);
    // Потолок — объявленная залом ценность: игрок не должен получить стол
    // дороже заявленного (иначе диапазоны залов в интерфейсе становятся ложью).
    const valueBudget = target;
    let value = 0;
    let covered = 0;
    this.shuffle(items);
    // Проходим список несколько раз: после пропуска дорогих предметов
    // освободившееся место заполняют более дешёвые.
    // ВАЖНО: уложенный предмет помечаем как использованный. Без этого один и
    // тот же объект укладывался повторно в следующих проходах — на столе
    // появлялись дубликаты с одинаковым id (ломает и доску, и подсказки).
    const used = new Set<ItemInstance>();
    for (let pass = 0; pass < 4; pass++) {
      let placedThisPass = 0;
      for (const item of items) {
        if (used.has(item)) continue;
        if (covered >= coverTarget && value >= target) break;
        const area = item.w * item.h;
        if (covered + area > cellBudget) continue;
        if (value + item.value > valueBudget) continue;
        if (this.tryPlaceItem(item)) {
          used.add(item);
          value += item.value;
          covered += area;
          placedThisPass += 1;
        }
      }
      if (placedThisPass === 0) break;
      if (covered >= coverTarget && value >= target) break;
    }
    // Страховка от «дырявой» упаковки: если площадь сильно не добрана,
    // добираем её любыми дешёвыми предметами в пределах бюджета.
    if (covered < coverTarget) {
      const cheap = ITEM_CATALOG.filter((d) => d.value <= 6_000)
        .map((d) => instanceFromDef(d))
        .sort((a, b) => a.value - b.value);
      for (let pass = 0; pass < 30 && covered < coverTarget; pass++) {
        let placedThisPass = 0;
        for (const filler of cheap) {
          if (used.has(filler)) continue;
          if (covered >= coverTarget) break;
          const area = filler.w * filler.h;
          if (covered + area > cellBudget) continue;
          if (value + filler.value > valueBudget) continue;
          if (this.tryPlaceItem(filler)) {
            used.add(filler);
            value += filler.value;
            covered += area;
            placedThisPass += 1;
          }
        }
        if (placedThisPass === 0) break;
      }
    }
    this.finalizeTableValue();
  }

  /**
   * Фиксирует ценность стола по фактически выставленным предметам.
   * Цель при сборке и итог могут расходиться на дискретных предметах, и тогда
   * расчёт в итоговой таблице («стол минус ставка») не сходился бы с реальностью.
   */
  private finalizeTableValue(): void {
    const actual = itemsTotal(this.placed.map((pl) => pl.it));
    // Сборка из дискретных предметов может уйти за границы зала (клетки网格а
    // ограничивают, номиналы не совпадают с целью). Ценность стола — это
    // объявленная залом величина, поэтому держим её в рамках зала: игрок не
    // должен видеть в золотом зале стол дешевле его нижней границы.
    // Верхнюю границу держим жёстко (стол не дороже заявленного), нижнюю
    // обеспечивает повторная сборка в buildTable.
    this.tableValue = Math.min(actual, this.tier.tableMax);
  }

  /**
   * Упаковка предметов на столе: лежат вплотную друг к другу,
   * начиная с правого верхнего угла (ряды справа налево, сверху вниз) —
   * на телефоне первые предметы видны сразу, без прокрутки до низа стола.
   * Ориентация — случайная, при неудаче пробуется повёрнутая.
   */
  private tryPlaceItem(item: ItemInstance): boolean {
    const dims: [number, number][] =
      this.rng() < 0.5
        ? [[item.w, item.h], [item.h, item.w]]
        : [[item.h, item.w], [item.w, item.h]];
    for (const [w, h] of dims) {
      for (let y = 0; y + h <= GRID_H; y++) {
        for (let x = GRID_W - w; x >= 0; x--) {
          if (this.overlapsPlaced(x, y, w, h)) continue;
          this.placed.push({ it: item, x, y, w, h, revealed: false });
          return true;
        }
      }
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

  /**
   * Карточка-анализатор: раскрывает редкость случайных скрытых предметов стола
   * лично игроку (границы предметов подсвечиваются цветом редкости только у него).
   * Возвращает текст ошибки или null при успехе.
   */
  useAnalyzerCard(playerId: string, count: number): string | null {
    if (this.phase !== 'auction' || !this.auction) return 'Анализатор можно применить только во время торгов';
    // только по-настоящему скрытые предметы: подсказка о том, что уже видно,
    // бесполезна и ломает контракт «подсказка указывает на закрытую клетку»
    const hidden = this.placed.filter((pl) => !pl.revealed);
    if (hidden.length === 0) return 'На столе нет скрытых предметов';
    const picked = this.shuffle(hidden).slice(0, Math.max(1, Math.min(count, hidden.length)));
    const hints: RarityHint[] = picked.map((pl) => ({ itemId: pl.it.id, rarity: pl.it.rarity }));
    const prev = this.rarityHints.get(playerId) ?? [];
    this.rarityHints.set(playerId, [...prev, ...hints]);
    this.changed();
    return null;
  }

  /** Персональная информация для конкретного игрока (только для его сокета) */
  personalSnapshot(playerId: string): PlayerPrivate | null {
    const reveals = this.privateReveals.get(playerId) ?? [];
    const hints = this.privateHints.get(playerId) ?? [];
    const rarityHints = this.rarityHints.get(playerId) ?? [];
    if (reveals.length === 0 && hints.length === 0 && rarityHints.length === 0) return null;
    return { reveals: reveals.slice(), hints: hints.slice(), rarityHints: rarityHints.slice() };
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
    // Ставку платит ТОЛЬКО победитель. Проигравшие свои ставки не теряют:
    // они уже внесли вступительный взнос, и на этом их расходы закончились.
    winner.cash -= price;
    winner.spent += price;
    const totalValue = itemsTotal(this.placed.map((pl) => pl.it));
    // предметы остаются на столе (для финального экрана), но переходят победителю
    for (const pl of this.placed) winner.inventory.push(pl.it);

    // Итог победителя: забрал стол стоимостью totalValue, заплатил price.
    // Если стол дороже ставки — он в плюсе, остальные просто ничего не получают
    // (но и не теряют). Если ставка дороже стола — победитель в минусе, и каждый
    // проигравший получает от банка 10% от этого минуса.
    const losers = this.players.filter((p) => p.id !== winnerId);
    const lostDeal = price - totalValue;
    let compensation = 0;
    let perLoser = 0;
    if (lostDeal > 0 && losers.length > 0) {
      perLoser = Math.floor(lostDeal * COMPENSATION_RATE);
      // КРИТИЧНО: суммарные выплаты не могут превышать то, что заплатил
      // победитель. Иначе при 3+ проигравших (по 10% на каждого = 30% минуса)
      // переплата становится выгодной и игроки печатают деньги из банка дома:
      // заплатил 1 000 000 за стол в 100 000 → минус 900 000 → вернули 270 000.
      const maxTotal = Math.max(0, price - compensationFloor(totalValue, price));
      const rawTotal = perLoser * losers.length;
      if (rawTotal > maxTotal) {
        perLoser = Math.floor(maxTotal / losers.length);
      }
      if (perLoser > 0) {
        for (const l of losers) l.cash += perLoser;
        compensation = perLoser * losers.length;
      }
    }
    // Серия побед: за азарт платит зал. Надбавка идёт из банка дома и
    // начисляется только победителю — это и есть награда за «поймал волну».
    const bonusRate = streakBonus(winner.streak);
    const bonus = bonusRate > 0 ? Math.round(price * bonusRate) : 0;
    if (bonus > 0) {
      winner.cash += bonus;
      winner.spent -= bonus;
      this.addLog(
        'result',
        'Серия побед ' + winner.streak + ': зал добавляет ' + fmt(bonus) +
          ' (' + Math.round(bonusRate * 100) + '%)',
      );
    }
    this.moneyToBank += price - compensation - bonus;
    // Запоминаем итоги последних торгов: к моменту финального экрана
    // this.auction уже сброшен, а игроку нужно видеть цену стола и ставку.
    this.finalAuction = {
      winnerId,
      price,
      tableValue: totalValue,
      perLoserCompensation: perLoser,
      voided: false,
    };
    this.addLog('result', 'Победитель: ' + winner.name + ' за ' + fmt(price) + ' — забирает все предметы стола');
    if (losers.length > 0) {
      if (lostDeal > 0) {
        this.addLog(
          'result',
          perLoser > 0
            ? 'Победитель в минусе на ' + fmt(lostDeal) + ': каждый проигравший получает ' +
              fmt(perLoser) + ' (10% от минуса)'
            : 'Победитель в минусе на ' + fmt(lostDeal) + ', но сумма слишком мала для выплат',
        );
      } else {
        this.addLog(
          'result',
          'Победитель в плюсе на ' + fmt(-lostDeal) + ': проигравшие ничего не получают и ничего не теряют',
        );
      }
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
    this.rememberVoided();
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

  /**
   * Строка итоговой таблицы. Профит считаем как разницу нетто-состояния:
   * вход и ставка уже вычтены из наличных, а полученные предметы учтены
   * в инвентаре — поэтому профит сразу показывает результат партии.
   */
  private standingRow(p: GPlayer): FinalStanding {
    const inventoryValue = itemsTotal(p.inventory);
    const total = p.cash + inventoryValue;
    const startTotal = p.startCash + p.startInventoryValue;
    return {
      playerId: p.id,
      cash: p.cash,
      inventoryValue,
      total,
      place: 0,
      startTotal,
      profit: total - startTotal,
      spent: p.spent,
      inventoryGained: Math.max(0, inventoryValue - p.startInventoryValue),
    };
  }

  /** Сгоревший стол (двойная ничья): победителя нет, деньги не двигались */
  private rememberVoided(): void {
    if (this.finalAuction) return;
    this.finalAuction = {
      winnerId: null,
      price: 0,
      tableValue: this.tableValue,
      perLoserCompensation: 0,
      voided: true,
    };
  }

  /** Итоги торгов для финальной таблицы */
  private auctionSummary(): {
    winnerId: string | null;
    price: number;
    tableValue: number;
    perLoserCompensation: number;
    voided: boolean;
  } {
    // Итоги уже зафиксированы в момент расчёта: сброс аукциона их не затрагивает
    if (this.finalAuction) return this.finalAuction;
    const result = this.auction?.result;
    return {
      winnerId: result?.winnerId ?? null,
      price: result?.price ?? 0,
      tableValue: this.tableValue,
      perLoserCompensation: 0,
      voided: Boolean(result?.voided),
    };
  }

  private finishGame(): void {
    this.revealAll();
    const standings: FinalStanding[] = this.players.map((p) => this.standingRow(p));
    standings.sort((a, b) => b.total - a.total || b.cash - a.cash || a.playerId.localeCompare(b.playerId));
    standings.forEach((s, i) => {
      s.place = i + 1;
    });
    const winnerId = standings[0].playerId;
    const winner = this.getPlayer(winnerId);
    this.final = { standings, winnerId, auction: this.auctionSummary() };
    this.phase = 'finished';
    this.finished = true;
    this.deadline = 0;
    this.addLog('result', 'Игра окончена! Победитель: ' + (winner?.name ?? '—'));
    this.changed();
    this.onFinished?.(this.buildReport());
  }

  private buildReport(): FinalReport {
    const standings: FinalStanding[] = this.players.map((p) => this.standingRow(p));
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
      profit: Object.fromEntries(standings.map((s) => [s.playerId, s.profit])),
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
      tier: {
        id: this.tier.id,
        name: this.tier.name,
        tagline: this.tier.tagline,
        entry: this.tier.entry,
        tableMin: this.tier.tableMin,
        tableMax: this.tier.tableMax,
        color: this.tier.color,
        icon: this.tier.icon,
      },
      tableValue: this.tableValue,
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
          // у закрытых клеток тоже храним itemId — по нему клиент рисует границы
          // предметов, редкость которых раскрыта лично игроку (карточки-анализаторы)
          cells[idx] = pl.revealed ? { kind: 'item', itemId: pl.it.id } : { kind: 'closed', itemId: pl.it.id };
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
