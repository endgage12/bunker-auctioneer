// Один бот: сокет, лобби, партия, мета-игра между партиями.
// Бот не имеет доступа к внутренностям движка — только публичный снимок состояния.
import type { BotCharacter, PublicGame, PublicPlayer, PublicTier, TierDef } from '@auctioneer/shared';
import { findCard, sessionGames, sessionPauseMs, TIERS, TIER_IDS, tierUnlockedByRank } from '@auctioneer/shared';
import { BotClient } from './client';
import {
  commentOnResult,
  decideEntry,
  decideBid,
  shouldUseAnalyzer,
} from './brain';
import type { BotPosture, Rng } from './brain';
import { BOT_CHAT, BOT_ENTRY_RESERVE, BOT_MIN_CASH } from './options';

export interface BotAccount {
  id: string;
  name: string;
  token: string;
}

export interface BotDeps {
  apiOrigin: string;
  character: BotCharacter;
  rng: Rng;
  /** карточки-анализаторы в наличии (запрошены у сервера по REST) */
  analyzerCardIds: () => string[];
  /** агрессия из-за погони за топ-10 и настроение после партий */
  posture: () => BotPosture;
  /** сообщить о завершённой партии (место, всего игроков) */
  onGameFinished: (place: number, players: number) => void;
  /** мета-игра между партиями (торговец, барахолка, сеты, колесо, Санта) */
  metaGame?: () => Promise<void>;
  log?: (msg: string) => void;
}

type BotPhase = 'offline' | 'idle' | 'lobby' | 'playing';

export class Bot {
  readonly character: BotCharacter;
  /** сколько бот готов ждать старта партии в лобби, прежде чем вернуться в очередь */
  private static readonly STUCK_TIMEOUT_MS = 30_000;
  /** как часто бот может ходить «продавать хлам» */
  private static readonly REFILL_COOLDOWN_MS = 20_000;
  private client: BotClient | null = null;
  private phase: BotPhase = 'offline';
  /** код комнаты, в которой бот сейчас находится (нужен пулу для матчмейкинга) */
  roomCode: string | null = null;
  private actedRound = '';
  private analyzerUses = 0;
  private gamesThisSession = 0;
  private sessionLimit = 1;
  private pauseUntil = 0;
  private stopped = false;
  /** когда бот вошёл в текущее лобби */
  private lobbySinceMs = 0;
  /** когда началась текущая партия */
  private playingSinceMs = 0;
  /** время последнего снимка состояния от сервера */
  private lastStateAt = 0;
  /** заявка на подбор лобби: время, чтобы измерить ожидание */
  private matchRequestedAt = 0;
  /** идёт пополнение наличных (продажа хлама) */
  private refilling = false;
  /** когда последний раз ходил продавать хлам */
  private lastRefillAt = 0;

  constructor(
    readonly account: BotAccount,
    private readonly deps: BotDeps,
  ) {    this.character = deps.character;
    this.sessionLimit = sessionGames(this.character, this.deps.rng);
  }

  get phaseName(): BotPhase {
    return this.phase;
  }

  /** ДИАГНОСТИКА (временно): текущая фаза для отладки матчмейкинга */
  get debugPhase(): string {
    return this.phase;
  }

  /** Свободен ли бот для новой партии */
  get available(): boolean {
    return !this.stopped && (this.phase === 'idle' || this.phase === 'offline') && Date.now() >= this.pauseUntil;
  }

  get inGame(): boolean {
    return this.phase === 'playing';
  }

  get status(): string {
    if (this.stopped) return 'остановлен';
    if (this.phase === 'playing') return 'в партии';
    if (this.phase === 'lobby') return 'в лобби';
    if (Date.now() < this.pauseUntil) return 'на паузе';
    return 'свободен';
  }

  private log(msg: string): void {
    this.deps.log?.('[' + this.account.name + '] ' + msg);
  }

  /** Подключиться к серверу и перейти в режим ожидания */
  async start(): Promise<void> {
    this.stopped = false;
    this.client = new BotClient(this.deps.apiOrigin, this.account.token, {
      onState: (state) => this.onState(state),
      onError: (message) => this.log('ошибка: ' + message),
    });
    this.client.setMyId(this.account.id);
    await this.client.connect();
    this.phase = 'idle';
    this.log('на связи, характер «' + this.character.name + '»');
  }

  stop(): void {
    this.stopped = true;
    this.client?.leaveRoom();
    this.client?.disconnect();
    this.client = null;
    this.phase = 'offline';
  }

  /**
   * Какой зал бот выбирает при своём капитале. Логика как у живого игрока:
   * берём самый дорогой зал, который можем себе позволить, но оставляем запас
   * на пару входов — иначе первый же проигрыш выбрасывает из игры.
   */
  pickTier(cash: number): TierDef {
    let best: TierDef | null = null;
    for (const id of TIER_IDS) {
      const tier = TIERS[id];
      // Мало иметь деньги: зал открывается ещё и по рангу. Без этой проверки
      // бот бесконечно долбился в закрытый зал и не играл вообще.
      if (!tierUnlockedByRank(tier.id, this.lastKnownWinnings)) continue;
      if (cash >= tier.entry + BOT_ENTRY_RESERVE) best = tier;
    }
    // Если на достойный зал не хватает, идём в младший: пусть сервер скажет
    // «нужно 10 000» — это сигнал пулу отправить бота к торговцу за деньгами.
    // Без этого бот с 50к выбирал серебро, получал отказ по рангу и простаивал.
    return best ?? TIERS.bronze;
  }

  /** Отправить бота в лобби выбранного зала. Возвращает код комнаты. */
  async joinLobby(tier?: TierDef): Promise<string | null> {
    if (!this.client || this.stopped) return null;
    if (!this.available) return null;
    const chosen = tier ?? this.pickTier(this.lastKnownCash);
    const resp = await this.safe(() => this.client!.play(chosen.id));
    if (!resp || 'error' in resp) {
      // одну и ту же причину не повторяем в логе бесконечно
      const reason = resp && 'error' in resp ? resp.error : 'нет ответа';
      if (this.lastLobbyError !== reason) {
        this.lastLobbyError = reason;
        this.log('не смог войти в лобби: ' + reason);
      }
      this.releaseLobby();
      return null;
    }
    this.lastLobbyError = '';
    this.enterLobby(resp.code);
    return resp.code;
  }

  /** Отправить бота в конкретную комнату (дозаполнение лобби) */
  async joinLobbyTo(code: string): Promise<boolean> {
    if (!this.client || this.stopped) return false;
    if (!this.available) return false;
    const resp = await this.safe(() => this.client!.joinRoom(code));
    if (!resp || 'error' in resp) {
      if (resp && 'error' in resp) this.log('не смог войти в комнату ' + code + ': ' + resp.error);
      this.releaseLobby();
      return false;
    }
    this.enterLobby(resp.code);
    return true;
  }

  /**
   * Снять «занятость лобби». Нужно, когда комната исчезла или вход не удался:
   * иначе бот навсегда останется в фазе «в лобби» и выпадет из матчмейкинга.
   */
  private releaseLobby(): void {
    if (this.phase === 'lobby') {
      this.phase = 'idle';
      this.roomCode = null;
    }
  }

  /**
   * Сторож: если бот «сидит в лобби» дольше положенного, а партия так и не
   * началась (комнату убрали, состав не собрался), возвращаем его в строй.
   */
  checkStuck(roomAlive: (code: string) => boolean, now = Date.now()): void {
    if (this.stopped) return;
    if (this.phase !== 'lobby' && this.phase !== 'playing') return;
    const since = this.phase === 'lobby' ? this.lobbySinceMs : this.playingSinceMs;
    if (now - since < Bot.STUCK_TIMEOUT_MS) return;
    // Комната жива и состояние обновлялось — бот правда ждёт или играет.
    if (this.roomCode && roomAlive(this.roomCode)) {
      const quiet = now - this.lastStateAt;
      if (this.phase === 'lobby' || quiet < Bot.STUCK_TIMEOUT_MS) return;
    }
    this.log('завис в состоянии «' + this.status + '» — возвращаюсь в очередь подбора');
    this.client?.leaveRoom();
    this.phase = 'idle';
    this.roomCode = null;
    this.actedRound = '';
    this.analyzerUses = 0;
  }

  /** Сколько времени бот ждёт старта партии в лобби */
  get lobbyIdleMs(): number {
    return this.phase === 'lobby' ? Date.now() - this.lobbySinceMs : 0;
  }

  /** Ошибка сети/сервера не должна превращаться в необработанный reject */
  private async safe<T>(fn: () => Promise<T>): Promise<T | null> {
    try {
      return await fn();
    } catch (err) {
      this.log('сбой запроса: ' + (err as Error).message);
      return null;
    }
  }

  private enterLobby(code: string): void {
    this.roomCode = code;
    this.phase = 'lobby';
    this.lobbySinceMs = Date.now();
    this.matchRequestedAt = Date.now();
    // как живой игрок: ждём секунду-полторы и жмём «готов»
    setTimeout(() => {
      if (this.phase === 'lobby' && !this.stopped) this.client?.ready(true);
    }, 400 + Math.floor(this.deps.rng() * 1600));
  }

  /** Запрошенное время начала подбора — нужно метрикам ожидания */
  get matchRequestTs(): number {
    return this.matchRequestedAt;
  }

  /** Обработка снимка состояния: единственный источник информации о партии */
  private onState(state: PublicGame): void {
    if (this.stopped) return;
    if (state.tier) this.currentTier = state.tier;
    if (state.phase === 'waiting') {
      this.lastStateAt = Date.now();
      if (this.phase === 'playing') this.phase = 'lobby';
      this.roomCode = state.code ?? this.roomCode;
      // свободные места в комнате — можно позвать других ботов через пул
      return;
    }

    const me = state.players.find((p) => p.id === this.account.id);
    if (!me) return;
    this.lastStateAt = Date.now();
    if (this.phase !== 'playing') {
      this.phase = 'playing';
      this.playingSinceMs = Date.now();
      this.analyzerUses = 0;
      this.actedRound = '';
      this.log('партия началась');
    }

    // завершение партии
    if (state.phase === 'finished' || state.final) {
      this.finishGame(state, me);
      return;
    }

    if (state.phase === 'ready') {
      this.actEntry(state, me);
      return;
    }

    if (state.phase === 'auction') {
      this.actAuction(state, me);
    }
  }

  /** Подтверждение входа: плата фиксирована залом, выбирать нечего */
  private actEntry(state: PublicGame, me: PublicPlayer): void {
    if (me.ante > 0) return; // вход уже подтверждён
    const key = 'entry:' + (state.code ?? '');
    if (this.actedRound === key) return;
    this.actedRound = key;
    const decision = decideEntry(state, me, this.character, this.entryFee, this.deps.rng);
    setTimeout(() => {
      if (this.stopped) return;
      if (!decision.value) {
        this.log('не хватает на вход — выхожу из зала');
        this.leaveLobby();
        return;
      }
      this.client?.ante(0);
      if (BOT_CHAT && decision.say) this.say(decision.say);
    }, decision.delayMs);
  }

  /** Зал текущей партии (приходит из снимка состояния) */
  private currentTier: PublicTier | null = null;
  /** последние известные наличные (обновляет пул) — по ним выбирается зал */
  lastKnownCash = 0;
  /** накопленный итог партий — по нему определяется доступный зал */
  lastKnownWinnings = 0;
  /** последняя причина отказа войти в лобби (чтобы не спамить лог) */
  private lastLobbyError = '';

  /** Плата за вход в текущем зале */
  private get entryFee(): number {
    return this.currentTier?.entry ?? 0;
  }

  /** Выйти из комнаты и вернуться в очередь подбора */
  private leaveLobby(): void {
    this.client?.leaveRoom();
    this.phase = 'idle';
    this.roomCode = null;
  }

  private actAuction(state: PublicGame, me: PublicPlayer): void {
    const a = state.auction;
    if (!a) return;
    const key = 'r' + a.round + ':' + a.phase;
    if (this.actedRound === key) return;

    if (a.phase === 'reveal') {
      // во время раскрытия бот «думает» и иногда применяет анализатор
      this.actedRound = key;
      if (BOT_CHAT && this.deps.rng() < 0.05) {
        this.say(this.character.risk > 0.6 ? 'интересный расклад' : 'посмотрим, что откроют');
      }
      return;
    }

    if (a.phase !== 'bid') return;
    // в раунде могли выбыть — тогда сервер не ждёт ставки
    if (me.passed) return;
    this.actedRound = key;

    // Одна особая карточка за раунд — то же правило, что и у игрока.
    // Сервер его тоже проверяет, но бот не должен даже пытаться: иначе
    // он жёг бы карточки вслепую и получал отказ.
    const alreadyUsed = (state.players.find((p) => p.id === me.id)?.cardsUsedThisRound ?? 0) > 0;
    if (!alreadyUsed && shouldUseAnalyzer(state, this.character, this.analyzerUses, this.deps.rng)) {
      const cardId = this.pickAnalyzerCard();
      if (cardId) {
        this.analyzerUses += 1;
        setTimeout(() => {
          if (this.stopped) return;
          void this.client
            ?.useCard(cardId)
            .then((r) => {
              if (!r.ok) this.log('анализатор не применился: ' + (r.error ?? ''));
            })
            .catch(() => undefined);
        }, Math.round(1000 + this.deps.rng() * 2500));
      }
    }

    const decision = decideBid(state, me, this.character, this.deps.posture(), this.deps.rng);
    setTimeout(() => {
      if (this.stopped) return;
      this.client?.bid(decision.value.pass ? 0 : decision.value.amount);
      if (BOT_CHAT && decision.say) this.say(decision.say);
    }, decision.delayMs);
  }

  /**
   * Самый сильный анализатор из руки: раскрыть больше предметов выгоднее,
   * а слабые карточки лучше сохранить на потом. Если карточек несколько
   * копий — берём ту, у которой выше сила.
   */
  private pickAnalyzerCard(): string | undefined {
    const ids = this.deps.analyzerCardIds();
    if (ids.length === 0) return undefined;
    return [...ids].sort((a, b) => (findCard(b)?.power ?? 0) - (findCard(a)?.power ?? 0))[0];
  }

  private say(text: string): void {
    this.client?.say(text);
  }

  private finishGame(state: PublicGame, me: PublicPlayer): void {
    const final = state.final;
    const place = final?.standings?.find((s) => s.playerId === me.id)?.place ?? 0;
    const players = final?.standings?.length ?? state.players.length;
    this.phase = 'idle';
    this.roomCode = null;
    this.actedRound = '';
    this.analyzerUses = 0;
    this.gamesThisSession += 1;

    if (place > 0) {
      this.deps.onGameFinished(place, players);
      if (BOT_CHAT) {
        const line = commentOnResult(place, players, this.character, this.deps.rng);
        if (line) this.say(line);
      }
      this.log('партия окончена, место ' + place + ' из ' + players);
    }

    // сессия закончилась — «ушёл по делам»
    if (this.gamesThisSession >= this.sessionLimit) {
      const pause = sessionPauseMs(this.character, this.deps.rng);
      this.pauseUntil = Date.now() + pause;
      this.gamesThisSession = 0;
      this.sessionLimit = sessionGames(this.character, this.deps.rng);
      this.log('уходит на паузу на ' + Math.round(pause / 1000) + 'с');
    } else if (this.deps.metaGame) {
      // между партиями — живые дела: торговец, барахолка, сеты, колесо
      void this.deps.metaGame().catch(() => undefined);
    }

    this.client?.leaveRoom();
  }

  /**
   * Хочет ли бот играть прямо сейчас (учитывает паузы и наличные).
   *
   * Важно: смотрим именно на НАЛИЧНЫЕ, а не на общее состояние. Бот, который
   * скупился на барахолке, может быть богат предметами, но не иметь чем сделать
   * вступительную ставку. Такой бот не выпадает из парка навсегда — он уходит
   * «продать хлам торговцу» и возвращается с деньгами (см. botsNeedCash в пуле).
   */
  wantsToPlay(cash: number): boolean {
    if (!this.available) return false;
    if (cash < BOT_MIN_CASH) return false;
    return true;
  }

  /**
   * Бот «без денег»: играть не может, но может распродать инвентарь.
   * Условие то же, что у available (idle/offline и не на паузе), — иначе пул
   * не сможет отправить к торговцу бота, который ещё не подключался.
   */
  needsCash(cash: number): boolean {
    if (this.stopped || cash >= BOT_MIN_CASH) return false;
    if (this.phase !== 'idle' && this.phase !== 'offline') return false;
    return Date.now() >= this.pauseUntil;
  }

  /** Одноразовая попытка пополнить наличные (продажа предметов торговцу) */
  async refillCash(): Promise<void> {
    if (this.refilling || this.stopped) return;
    // Не дёргаем торговца каждый тик: пополнение — операция «сходил на рынок»
    if (Date.now() - this.lastRefillAt < Bot.REFILL_COOLDOWN_MS) return;
    this.lastRefillAt = Date.now();
    this.refilling = true;
    try {
      await this.deps.metaGame?.();
    } catch {
      /* не критично: попробуем в следующий раз */
    } finally {
      this.refilling = false;
    }
  }
}
