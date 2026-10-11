// Парк ботов: создание аккаунтов, поддержание онлайна, дозаполнение лобби.
import {
  CARD_DEFS,
  MAX_PLAYERS,
  botAvatar,
  botName,
  hashSeed,
  mulberry32,
  pickCharacter,
} from '@auctioneer/shared';
import type { BotCharacter } from '@auctioneer/shared';
import * as db from '../db';
import { signToken } from '../auth';
import { manager } from '../game/manager';
import type { Room } from '../game/manager';
import { Bot } from './bot';
import type { BotPosture } from './brain';
import { botMetaGame } from './meta';
import { BOTS_ENABLED, BOTS_PER_LOBBY, BOT_COUNT, MATCH_INTERVAL_MS, RESERVE_ROOMS, ROOM_SHARE } from './options';
import { matchmakingStats, noteHumanMatchFilled, noteHumanMatchRequest, noteLobbyWait, clearHumanWaitIfStale, humansWaiting } from './metrics';

export interface PoolStats {
  enabled: boolean;
  total: number;
  online: number;
  available: number;
  inGame: number;
  inLobby: number;
  paused: number;
  /** сколько партий идёт прямо сейчас */
  gamesInProgress: number;
  /** сколько мест в комнатах ожидания свободно (сюда сядет живой игрок) */
  freeSeats: number;
  characters: Record<string, number>;
}

/** Бот + его долговременное состояние (сессия, настроение, цель топ-10) */
interface BotEntry {
  bot: Bot;
  accountId: string;
  cash: number;
  /** последние результаты (1 — победа, 2 — середина, 3 — низ) для tilt */
  recentResults: number[];
  /** место в общей таблице лидеров */
  rank: number | null;
  /** разрыв до 10-го места по «счёту», валюта */
  gapToTop10: number;
}

export class BotPool {
  private entries: BotEntry[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private started = false;
  private apiOrigin = '';
  private log: (msg: string) => void = () => undefined;
  /** защита от наложения циклов матчмейкинга */
  private ticking = false;
  /** время последнего статусного лога */
  private lastStatusAt = 0;
  /** когда начался текущий цикл матчмейкинга */
  private tickStartedAt = 0;
  /** через сколько считать цикл зависшим */
  private static readonly TICK_TIMEOUT_MS = 45_000;
  /**
   * Боты, уже занятые асинхронной операцией входа в лобби. Без этого набора
   * один и тот же бот успевал «забронироваться» дважды: фаза меняется только
   * после ответа сервера, а между тиками и вызовом fillRoom проходит время.
   */
  private reserved = new Set<string>();
  /** комнаты, куда парк уже подсадил своих ботов (чтобы не переполнять) */
  private satiated = new Set<string>();

  get size(): number {
    return this.entries.length;
  }

  get isRunning(): boolean {
    return this.started;
  }

  stats(): PoolStats {
    const characters: Record<string, number> = {};
    let online = 0;
    let available = 0;
    let inGame = 0;
    let inLobby = 0;
    for (const e of this.entries) {
      characters[e.bot.character.name] = (characters[e.bot.character.name] ?? 0) + 1;
      const st = e.bot.status;
      if (st !== 'остановлен') online += 1;
      if (e.bot.available) available += 1;
      if (e.bot.inGame) inGame += 1;
      if (st === 'в лобби') inLobby += 1;
    }
    const games = manager.debugRooms().filter((r) => r.state === 'game').length;
    return {
      enabled: BOTS_ENABLED,
      total: this.entries.length,
      online,
      available,
      inGame,
      inLobby,
      paused: Math.max(0, online - available - inGame - inLobby),
      gamesInProgress: games,
      freeSeats: this.freeSeats(),
      characters,
    };
  }

  /** ДИАГНОСТИКА (временно): разбивка по фазам ботов */
  debugBreakdown(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const e of this.entries) {
      const key = e.bot.debugPhase + (this.reserved.has(e.accountId) ? '+бронь' : '');
      out[key] = (out[key] ?? 0) + 1;
    }
    return out;
  }

  /** Сводка по ботам для админки: кто чем занят */
  roster(): Array<{ name: string; character: string; status: string; rank: number | null; cash: number }> {
    return this.entries.map((e) => ({
      name: e.bot.account.name,
      character: e.bot.character.name,
      status: e.bot.status,
      rank: e.rank,
      cash: Math.round(e.cash),
    }));
  }

  /**
   * Создать аккаунты ботов (идемпотентно) и подключить их.
   * Боты получают ровно стартовый набор новичка — как обычные игроки.
   */
  async start(apiOrigin: string, logger?: (msg: string) => void): Promise<void> {
    if (!BOTS_ENABLED || this.started) return;
    this.started = true;
    this.apiOrigin = apiOrigin;
    if (logger) this.log = logger;

    for (let i = 0; i < BOT_COUNT; i++) {
      const email = 'bot-' + (i + 1) + '@auctioneer.local';
      const name = botName(i);
      const seed = hashSeed(email);
      const rng = mulberry32(seed);
      const character: BotCharacter = pickCharacter(rng);
      const avatar = botAvatar(name, seed);
      const user = db.findOrCreateBotUser(email, name, avatar, character.id);
      const token = await signToken(user.id);
      const entry: BotEntry = {
        bot: null as unknown as Bot,
        accountId: user.id,
        cash: user.cash,
        recentResults: [],
        rank: null,
        gapToTop10: 0,
      };
      entry.bot = new Bot(
        { id: user.id, name: user.name, token },
        {
          apiOrigin,
          character,
          rng,
          analyzerCardIds: () =>
            db
              .getCards(user.id)
              .filter((c) => CARD_DEFS.find((d) => d.id === c.cardId)?.setId === 'analyzers')
              .map((c) => c.cardId),
          posture: () => this.postureOf(entry),
          onGameFinished: (place, players) => this.noteResult(entry, place, players),
          metaGame: () => botMetaGame(apiOrigin, token, user.id, character, rng),
          log: this.log,
        },
      );
      this.entries.push(entry);
    }

    // подключаем парк с разбросом, чтобы не бить по серверу залпом
    let failed = 0;
    for (const e of this.entries) {
      try {
        await e.bot.start();
      } catch (err) {
        failed += 1;
        this.log('не удалось подключить бота: ' + (err as Error).message);
      }
      await sleep(15);
    }
    this.log('парк ботов запущен: ' + this.entries.length + ' шт.' + (failed ? ', ошибок: ' + failed : ''));
    this.timer = setInterval(() => void this.tick(), MATCH_INTERVAL_MS);
    void this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const e of this.entries) e.bot.stop();
    this.entries = [];
    this.started = false;
  }

  /**
   * Настроение и амбиции бота.
   * Главная цель — попасть в топ-10 богатейших: при отставании бот играет
   * агрессивнее (в рамках своего характера), а попав в топ — бережёт позицию.
   */
  private postureOf(entry: BotEntry): BotPosture {
    const wins = entry.recentResults.filter((r) => r === 1).length;
    const losses = entry.recentResults.filter((r) => r === 3).length;
    const morale = Math.max(0, Math.min(1, 0.5 + wins * 0.16 - losses * 0.12));
    let ambition = 1;
    if (entry.rank == null || entry.rank > 10) {
      ambition = 1 + Math.min(0.5, Math.max(0, entry.gapToTop10) / 3_000_000);
    } else {
      ambition = 0.92;
    }
    return { morale, ambition };
  }

  private noteResult(entry: BotEntry, place: number, players: number): void {
    entry.recentResults.push(place === 1 ? 1 : place >= players ? 3 : 2);
    if (entry.recentResults.length > 6) entry.recentResults.shift();
    const user = db.getUserById(entry.accountId);
    entry.cash = user?.cash ?? entry.cash;
  }

  /** Ранги ботов по общей таблице лидеров (цель — топ-10) */
  private refreshRanks(): void {
    const board = db.getLeaderboard(1, 1000, '', true);
    const tenth = board.entries.find((e) => e.rank === 10);
    const byId = new Map(board.entries.map((e) => [e.id, e]));
    for (const e of this.entries) {
      const row = byId.get(e.accountId);
      if (!row) {
        e.rank = null;
        e.gapToTop10 = 0;
        continue;
      }
      e.rank = row.rank;
      e.cash = row.cash;
      e.bot.lastKnownCash = row.cash;
      // ранг определяет, какие залы доступны боту
      e.bot.lastKnownWinnings = db.getUserById(e.accountId)?.totalWinnings ?? 0;
      e.gapToTop10 = row.rank > 10 && tenth ? Math.max(0, tenth.netWorth - row.netWorth) : 0;
    }
  }

  /**
   * Цикл матчмейкинга:
   *  1) освежить ранги (цель топ-10);
   *  2) дозаполнить существующие лобби (сначала те, где сидит живой игрок);
   *  3) поддержать целевое число одновременных партий, открывая новые лобби из ботов.
   */
  private async tick(): Promise<void> {
    if (!this.started) return;
    if (this.ticking) {
      // Сторож: если прошлый цикл не завершился за отведённое время, значит он
      // завис на сетевом ожидании. Без этого матчмейкинг умирает молча —
      // ни одна партия больше не стартует.
      if (Date.now() - this.tickStartedAt < BotPool.TICK_TIMEOUT_MS) return;
      this.log('цикл матчмейкинга завис — перезапускаю');
      this.ticking = false;
    }
    this.ticking = true;
    this.tickStartedAt = Date.now();
    try {
      this.refreshRanks();

      // Сторож: боты, застрявшие в лобби (комнату убрали/состав не собрался),
      // возвращаются в очередь. Без этого парк «протекает» и живому игроку
      // перестаёт хватать соперников.
      for (const e of this.entries) {
        e.bot.checkStuck((code) => {
          const r = manager.getRoom(code);
          return !!r && (r.state === 'game' || r.members.size > 0);
        });
      }
      // брони могли остаться от упавшей операции — чистим те, чей бот уже не свободен
      for (const id of this.reserved) {
        const e = this.entries.find((x) => x.accountId === id);
        if (!e) this.reserved.delete(id);
      }

      // Боты без наличных не могут играть (нужна вступительная ставка), но у них
      // полно предметов. Отправляем их «к торговцу» — продать хлам и вернуться
      // в игру. Это то же действие, что доступно человеку через барахолку.
      for (const e of this.entries) {
        if (!e.bot.needsCash(e.cash)) continue;
        void e.bot.refillCash().then(() => {
          const user = db.getUserById(e.accountId);
          e.cash = user?.cash ?? e.cash;
        });
      }

      // 1. Дозаполнение существующих комнат ожидания.
      //    Комнаты с живым игроком заполняем ПЕРВЫМИ и до полного состава —
      //    именно от них зависит SLA 30 секунд.
      const waiting = manager.debugRooms().filter((r) => r.state === 'waiting' && r.members.size < MAX_PLAYERS);
      const humanRooms = waiting.filter(hasHuman);
      const botRooms = waiting.filter((r) => !hasHuman(r) && !this.satiated.has(r.code));

      for (const room of humanRooms) {
        const seats = MAX_PLAYERS - room.members.size;
        let added = 0;
        for (let i = 0; i < seats; i++) {
          const entry = this.claim();
          if (!entry) break;
          if (await this.sendToRoom(entry, room.code)) added += 1;
        }
        if (added > 0) noteHumanMatchFilled();
      }

      // Чисто ботовые комнаты «подогреваем» до состава, при котором партия стартует
      for (const room of botRooms) {
        const seats = Math.min(MAX_PLAYERS - room.members.size, BOTS_PER_LOBBY);
        if (seats <= 0) {
          this.satiated.add(room.code);
          continue;
        }
        let sent = 0;
        for (let i = 0; i < seats; i++) {
          const entry = this.claim();
          if (!entry) break;
          if (await this.sendToRoom(entry, room.code)) sent += 1;
        }
        // больше в эту комнату не сажаем: она своё получила (или мест не осталось)
        if (sent >= seats || room.members.size >= MAX_PLAYERS) this.satiated.add(room.code);
      }

      // 2. Новые лобби из ботов: играют между собой, чтобы столы не пустовали.
      //
      //    Два ограничения:
      //     а) одновременно должно идти достаточно партий (целевое число комнат);
      //     б) у парка обязан оставаться запас СВОБОДНЫХ ботов — иначе живой игрок,
      //        создав свою комнату, будет ждать, пока освободится чужой бот.
      const roomTarget = Math.max(2, Math.round(this.entries.length * ROOM_SHARE));
      const hosted = this.activeRoomCount();
      clearHumanWaitIfStale();
      const reserve = this.reserveBots();
      const botsPerRoom = BOTS_PER_LOBBY + 1; // хост + подсаженные
      // Резерв держим только из играбельных ботов: обедневшие в него не входят,
      // иначе они блокируют открытие комнат.
      const playable = this.freeCount();
      // Резерв не может съедать весь парк: если играбельных ботов мало (парк
      // обеднел), держим под живого игрока не больше половины — иначе подбор
      // встаёт совсем (11 свободных при резерве 11 → открываем 0).
      const reserveRooms = Math.min(RESERVE_ROOMS, Math.floor(playable / botsPerRoom / 2));
      const byReserve = Math.max(0, Math.floor(playable / botsPerRoom) - reserveRooms);
      let toOpen = Math.min(roomTarget - hosted, byReserve);
      this.maybeStatusLog(hosted, toOpen);
      // ВАЖНО: резерв пересчитываем на каждой итерации. Иначе цикл за один тик
      // забирает всех свободных ботов, и живому игроку не остаётся соперников.
      while (toOpen > 0) {
        if (this.freeCount() <= Math.min(reserve, Math.max(0, playable - botsPerRoom))) break;
        const host = this.claim();
        if (!host) break;
        const code = await this.sendToRoom(host, null);
        if (!code) break;
        this.satiated.add(code);
        for (let i = 0; i < BOTS_PER_LOBBY; i++) {
          const mate = this.claim();
          if (!mate) break;
          await this.sendToRoom(mate, code);
        }
        toOpen -= 1;
      }
    } finally {
      this.ticking = false;
    }
  }

  /**
   * Компактный статус парка раз в 30 секунд: без него отлаживать SLA вслепую
   * невозможно, а полный лог тонет в сообщениях ботов.
   */
  private maybeStatusLog(hosted: number, toOpen: number): void {
    const now = Date.now();
    if (now - this.lastStatusAt < 30_000) return;
    this.lastStatusAt = now;
    const inGame = this.entries.filter((e) => e.bot.inGame).length;
    const inLobby = this.entries.filter((e) => e.bot.status === 'в лобби').length;
    const paused = this.entries.filter((e) => e.bot.status === 'на паузе').length;
    const free = this.freeCount();
    this.log(
      'статус: комнат=' + hosted + ' всего=' + this.entries.length +
        ' в партиях=' + inGame + ' в лобби=' + inLobby + ' на паузе=' + paused +
        ' свободны=' + free + ' без денег=' + this.brokeEntries().length +
        ' бронь=' + this.reserved.size +
        ' (сумма ' + (inGame + inLobby + paused + free + this.reserved.size) + ')' +
        ' ждут людей=' + humansWaiting() + ' откроем=' + toOpen,
    );
  }

  /**
   * Сколько ботов держим свободными под живых игроков.
   * Каждый ожидающий человек получает собственный полный состав сверх базового
   * резерва — иначе его комната останется полупустой.
   */
  private reserveBots(): number {
    const humans = humansWaiting();
    return (humans > 0 ? humans : RESERVE_ROOMS) * (BOTS_PER_LOBBY + 1);
  }

  /** Сколько мест свободно в комнатах ожидания (в них может сесть живой игрок) */
  private freeSeats(): number {
    let total = 0;
    for (const r of manager.debugRooms()) {
      if (r.state !== 'waiting') continue;
      total += Math.max(0, MAX_PLAYERS - r.members.size);
    }
    return total;
  }

  /** Комнаты ожидания + идущие партии */
  private activeRoomCount(): number {
    return manager.debugRooms().filter((r) => r.state === 'waiting' || r.state === 'game').length;
  }

  /**
   * Реально свободные боты: не в партии, не в лобби, не на паузе и не занятые
   * текущей асинхронной операцией. Именно это число — запас под живых игроков.
   */
  /**
   * Боты, свободные для новой партии: не в комнате, не на паузе и с деньгами
   * на вход. Именно они идут в подбор.
   */
  private freeEntries(): BotEntry[] {
    return this.entries.filter(
      (e) => !this.reserved.has(e.accountId) && e.bot.available && e.bot.wantsToPlay(e.cash),
    );
  }

  private freeCount(): number {
    return this.freeEntries().length;
  }

  /**
   * Свободные, но БЕЗ денег на вход. Они не участвуют в подборе, зато их можно
   * отправить к торговцу за наличными, поэтому резерв под живых игроков по ним
   * считать нельзя: иначе при обеднении парка резерв «съедает» всех играбельных
   * ботов и матчмейкинг встаёт (свободных 11, резерв тоже 11 → открываем 0).
   */
  private brokeEntries(): BotEntry[] {
    return this.entries.filter(
      (e) => !this.reserved.has(e.accountId) && e.bot.available && e.bot.needsCash(e.cash),
    );
  }

  /**
   * Забронировать свободного бота и вернуть его. Бронь снимается, когда бот
   * реально вошёл в лобби (или когда отправка не удалась).
   */
  private claim(): BotEntry | null {
    const e = this.freeEntries()[0];
    if (!e) return null;
    this.reserved.add(e.accountId);
    return e;
  }

  /** Отправить бота в комнату (code=null — в общий подбор) и снять бронь */
  private async sendToRoom(entry: BotEntry, code: string | null): Promise<string | null> {
    try {
      const joined = code ? await entry.bot.joinLobbyTo(code) : await entry.bot.joinLobby();
      return joined ? (code ?? entry.bot.roomCode) : null;
    } finally {
      this.reserved.delete(entry.accountId);
    }
  }

  /** Человек нажал «Играть» — фиксируем для метрик и сразу дозаполняем его лобби */
  noteHumanSearch(): void {
    noteHumanMatchRequest();
    // не ждём планового тика: живой игрок не должен сидеть в пустой комнате
    void this.tick();
  }

  /**
   * Немедленно дозаполнить конкретную комнату ботами и запустить партию.
   * Вызывается сразу после того, как живой игрок создал/занял лобби, —
   * так ожидание не зависит от планового тика матчмейкинга.
   */
  async fillRoom(room: Room): Promise<number> {
    if (!this.started) return 0;
    if (room.state !== 'waiting') return 0;
    const seats = MAX_PLAYERS - room.members.size;
    if (seats <= 0) return 0;

    let added = 0;
    for (let i = 0; i < seats; i++) {
      // Живому игроку отдаём ботов в первую очередь, но последний полный состав
      // в резерве держим: следующий человек тоже не должен ждать.
      if (this.freeCount() <= BOTS_PER_LOBBY + 1) break;
      const entry = this.claim();
      if (!entry) break;
      if (await this.sendToRoom(entry, room.code)) added += 1;
    }
    if (added > 0) noteHumanMatchFilled();
    return added;
  }

  /** Снимок метрик матчмейкинга */
  metrics() {
    return matchmakingStats();
  }

  /** Зафиксировать ожидание (вызывается при старте партии) */
  recordWait(waitMs: number, hadHuman: boolean): void {
    noteLobbyWait(waitMs, hadHuman);
  }
}

/** Есть ли в комнате живой игрок (не бот) */
function hasHuman(room: Room): boolean {
  for (const m of room.members.values()) {
    if (!db.isBotUser(m.id)) return true;
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const botPool = new BotPool();
