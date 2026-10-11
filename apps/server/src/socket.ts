// Socket.IO: комнаты, игровые действия, рассылка состояний
import type { Server, Socket } from 'socket.io';
import { C2S, S2C, AUTO_START_PLAYERS, DEFAULT_TIER, MIN_PLAYERS, RANKS, findCard, getTier, tierUnlockedByRank } from '@auctioneer/shared';
import * as db from './db';
import { canJoin, manager, waitingSnapshot } from './game/manager';
import type { Room } from './game/manager';
import { Game } from './game/engine';
import type { EnginePlayerSeed } from './game/engine';
import { verifyToken } from './auth';
import { config } from './config';
import { botPool } from './bots/pool';
import { noteHumanServed } from './bots/metrics';

let ioRef: Server;

function chan(room: Room): string {
  return 'room:' + room.code;
}

function roomSnap(room: Room) {
  return room.game ? room.game.snapshot() : waitingSnapshot(room);
}

interface SockLite {
  data: Record<string, unknown>;
  emit: (ev: string, payload: unknown) => void;
}

/**
 * Безопасная обёртка над ack-колбэком.
 *
 * Socket.IO кладёт колбэк ПОСЛЕДНИМ аргументом, поэтому искать его нужно с конца:
 * у события с payload колбэк лежит в args[1], у события без payload — в args[0].
 * Если клиент вообще не передал колбэк, вызов `ack(...)` упал бы с
 * «ack is not a function» и уронил процесс — на этот случай возвращаем пустышку.
 */
function ackOf<T>(...args: unknown[]): (resp: T) => void {
  for (let i = args.length - 1; i >= 0; i--) {
    if (typeof args[i] === 'function') return args[i] as (resp: T) => void;
  }
  return () => undefined;
}

/** Обработчик события: ошибка внутри не должна ронять сервер */
function guard(name: string, fn: (...args: unknown[]) => void): (...args: unknown[]) => void {
  return (...args: unknown[]) => {
    try {
      fn(...args);
    } catch (err) {
      console.error('[socket] ошибка в обработчике ' + name + ':', err);
    }
  };
}

function sendPersonalized(socket: SockLite, room: Room): void {
  const snap = roomSnap(room);
  const userId = socket.data.userId as string;
  // личная серия побед нужна клиенту, чтобы показать надбавку к призовым
  const streak = db.getUserById(userId)?.currentStreak ?? 0;
  const withStreak = { ...snap, myStreak: streak };
  if (room.game) {
    const priv = room.game.personalSnapshot(userId);
    if (priv) {
      socket.emit(S2C.state, { ...withStreak, private: priv });
      return;
    }
  }
  socket.emit(S2C.state, withStreak);
}

function broadcast(room: Room): void {
  void ioRef
    .in(chan(room))
    .fetchSockets()
    .then((sockets) => {
      for (const s of sockets) sendPersonalized(s, room);
    });
}

function findRoomOf(socket: Socket): Room | undefined {
  return socket.data.roomCode ? manager.getRoom(socket.data.roomCode) : undefined;
}

function sendError(socket: Socket, message: string): void {
  socket.emit(S2C.error, { message });
}

function withGame(socket: Socket, fn: (game: Game) => void): void {
  const room = findRoomOf(socket);
  if (!room?.game) return;
  fn(room.game);
  broadcast(room);
}

function startGame(room: Room): void {
  const playerBonuses: Record<string, string[]> = {};
  const seeds: EnginePlayerSeed[] = [...room.members.values()].map((m) => {    const profile = db.getProfile(m.id);
    const bonuses = db.getActiveSetBonuses(m.id);
    playerBonuses[m.id] = bonuses;
    const cashBonus = bonuses.includes('start_cash_bonus') ? 1.1 : 1;
    return {
      id: m.id,
      name: m.name,
      avatar: m.avatar,
      streak: profile?.currentStreak ?? 0,
      cash: Math.round((profile?.cash ?? m.cash) * cashBonus),
      inventory: (profile?.inventory ?? []).map((i) => ({
        id: i.id,
        defId: i.defId,
        name: i.name,
        rarity: i.rarity,
        value: i.value,
        w: i.w,
        h: i.h,
      })),
    };
  });
  const game = new Game({
    id: crypto.randomUUID(),
    code: room.code,
    hostId: room.hostId,
    players: seeds,
    tier: room.tier,
    playerBonuses,
    bettingSeconds: config.gameTimings.betting,
    revealSeconds: config.gameTimings.reveal,
    bidSeconds: config.gameTimings.bid,
    resolveSeconds: config.gameTimings.resolve,
    onStateChange: () => room.onUpdate?.(),
    onFinished: (report) => db.finalizeGame(report),
  });
  const ids = seeds.flatMap((s) => s.inventory.map((i) => i.id));
  db.markItemsInGame(ids, game.id);
  room.game = game;
  room.state = 'game';
  // метрика SLA: сколько игроки ждали лобби до старта партии
  const hadHuman = [...room.members.keys()].some((id) => !db.isBotUser(id));
  if (hadHuman) noteHumanServed();
  botPool.recordWait(Date.now() - room.waitingSince, hadHuman);
  broadcast(room);
}

/**
 * Автостарт комнаты ожидания:
 * — сразу, как только набралось AUTO_START_PLAYERS игроков;
 * — раньше, если игроков меньше, но все (минимум MIN_PLAYERS) нажали «Я готов/а».
 */
function maybeAutoStart(room: Room): void {
  if (room.state !== 'waiting') return;
  if (room.game && !room.game.isFinished) return;
  if (room.members.size >= AUTO_START_PLAYERS) {
    startGame(room);
    return;
  }
  if (room.members.size >= MIN_PLAYERS) {
    const allReady = [...room.members.values()].every((m) => m.ready);
    if (allReady) startGame(room);
  }
}

export function attachSocket(io: Server): void {
  ioRef = io;

  io.use(async (socket, next) => {
    const token = (socket.handshake.auth?.token as string) ?? '';
    const userId = await verifyToken(token);
    if (!userId) {
      next(new Error('unauthorized'));
      return;
    }
    socket.data.userId = userId;
    next();
  });

  io.on('connection', (socket) => {
    const uid = socket.data.userId as string;

    socket.on(C2S.createRoom, guard('room:create', (...args: unknown[]) => {
      const ack = ackOf<{ code: string } | { error: string }>(...args);
      const profile = db.getProfile(uid);
      if (!profile) {
        ack({ error: 'Пользователь не найден' });
        return;
      }
      const room = manager.createRoom({ id: profile.id, name: profile.name, avatar: profile.avatar, cash: profile.cash, ready: false });
      socket.data.roomCode = room.code;
      socket.join(chan(room));
      room.onUpdate = () => broadcast(room);
      ack({ code: room.code });
      broadcast(room);
      maybeAutoStart(room);
    }));

    socket.on(C2S.joinRoom, guard('room:join', (...args: unknown[]) => {
      const code = String(args[0] ?? '');
      const ack = ackOf<{ code: string } | { error: string }>(...args);
      const room = manager.getRoom(code);
      if (!room) {
        ack({ error: 'Комната не найдена' });
        return;
      }
      const check = canJoin(room, uid);
      if (!check.ok) {
        ack({ error: check.error ?? 'Нельзя войти' });
        return;
      }
      const profile = db.getProfile(uid);
      if (!profile) {
        ack({ error: 'Пользователь не найден' });
        return;
      }
      if (!room.members.has(uid)) {
        room.members.set(uid, { id: profile.id, name: profile.name, avatar: profile.avatar, cash: profile.cash, ready: false });
      }
      socket.data.roomCode = room.code;
      socket.join(chan(room));
      room.onUpdate = () => broadcast(room);
      room.game?.markOnline(uid, true);
      ack({ code: room.code });
      broadcast(room);
      maybeAutoStart(room);
    }));

    socket.on(C2S.play, guard('room:play', (...args: unknown[]) => {
      const ack = ackOf<{ code: string } | { error: string }>(...args);
      const body = (args[0] ?? {}) as { tier?: string };
      const profile = db.getProfile(uid);
      if (!profile) {
        ack({ error: 'Пользователь не найден' });
        return;
      }
      // живой игрок ищет партию — метрика ожидания и приоритет для ботов
      if (!db.isBotUser(uid)) botPool.noteHumanSearch();
      const current = findRoomOf(socket);
      if (current?.game && !current.game.isFinished) {
        ack({ error: 'Вы уже участвуете в партии — вернитесь в неё' });
        return;
      }
      if (current) {
        // уже в комнате ожидания — просто остаёмся в ней
        if (current.state === 'waiting') {
          ack({ code: current.code });
          broadcast(current);
          maybeAutoStart(current);
          // живому игроку сразу подсаживаем ботов, не дожидаясь тика матчмейкинга
          if (!db.isBotUser(uid)) void botPool.fillRoom(current);
          return;
        }
        // завершённая партия: выходим из старой комнаты перед подбором
        socket.data.roomCode = undefined;
        socket.leave(chan(current));
        current.members.delete(uid);
        if (current.members.size === 0) manager.removeRoom(current.code);
        else if (current.hostId === uid) current.hostId = current.members.keys().next().value as string;
        broadcast(current);
      }
      // Зал выбирает игрок: «Играть» приходит с идентификатором зала.
      // Кроме денег нужен ранг — так у игрока есть цель «дорасти до зала».
      const wantedTier = getTier(String(body?.tier ?? '')) ?? DEFAULT_TIER;
      if (!tierUnlockedByRank(wantedTier.id, profile.totalWinnings ?? 0)) {
        const need = RANKS.find((r) => r.unlocks === wantedTier.id);
        ack({
          error:
            wantedTier.name + ' открывается с ранга «' + (need?.name ?? '?') +
            '» — сыграйте ещё в младших залах',
        });
        return;
      }
      if (profile.cash < wantedTier.entry) {
        ack({ error: 'Нужно ' + wantedTier.entry.toLocaleString('ru-RU') + ' для входа в ' + wantedTier.name });
        return;
      }
      const target = manager.pickQuickRoom(wantedTier.id);
      let room: Room;
      if (target) {
        const check = canJoin(target, uid);
        if (!check.ok) {
          ack({ error: check.error ?? 'Нельзя войти' });
          return;
        }
        if (!target.members.has(uid)) {
          target.members.set(uid, { id: profile.id, name: profile.name, avatar: profile.avatar, cash: profile.cash, ready: false });
        }
        room = target;
      } else {
        room = manager.createRoom(
          { id: profile.id, name: profile.name, avatar: profile.avatar, cash: profile.cash, ready: false },
          wantedTier,
        );
      }
      socket.data.roomCode = room.code;
      socket.join(chan(room));
      room.onUpdate = () => broadcast(room);
      room.game?.markOnline(uid, true);
      ack({ code: room.code });
      broadcast(room);
      maybeAutoStart(room);
      // живой игрок получает соперников немедленно (SLA ожидания лобби)
      if (!db.isBotUser(uid)) void botPool.fillRoom(room);
    }));

    socket.on(C2S.ready, guard('room:ready', (...args: unknown[]) => {
      const payload = (args[0] ?? {}) as { ready?: boolean };
      const room = findRoomOf(socket);
      if (!room || room.state !== 'waiting') return;
      const member = room.members.get(uid);
      if (!member) return;
      member.ready = !!payload?.ready;
      broadcast(room);
      maybeAutoStart(room);
    }));

    socket.on(C2S.start, guard('room:start', () => {
      const room = findRoomOf(socket);
      if (!room) return;
      if (uid !== room.hostId) {
        sendError(socket, 'Только хост может начать игру');
        return;
      }
      if (room.game && !room.game.isFinished) {
        sendError(socket, 'Игра уже идёт');
        return;
      }
      if (room.members.size < MIN_PLAYERS) {
        sendError(socket, 'Нужно минимум ' + MIN_PLAYERS + ' игрока');
        return;
      }
      startGame(room);
    }));

    /** Подтверждение входа в партию: плата фиксирована залом */
    socket.on(C2S.ante, guard('game:ante', () => {
      withGame(socket, (game) => {
        const err = game.confirmEntry(uid);
        if (err) sendError(socket, err);
      });
    }));

    socket.on(C2S.bid, guard('game:bid', (...args: unknown[]) => {
      const payload = (args[0] ?? {}) as { amount: number };
      withGame(socket, (game) => {
        const err = game.submitBid(uid, Number(payload.amount));
        if (err) sendError(socket, err);
      });
    }));

    /** Применить карточку-анализатор во время партии (личная, влияет только на владельца) */
    socket.on(C2S.useCard, guard('card:use', (...args: unknown[]) => {
      const payload = (args[0] ?? {}) as { cardId?: string };
      const ack = ackOf<{ ok: boolean; error?: string }>(...args);
      const room = findRoomOf(socket);
      if (!room?.game) {
        ack({ ok: false, error: 'Карточку можно применить только в партии' });
        return;
      }
      const def = findCard(String(payload?.cardId ?? ''));
      if (!def || def.setId !== 'analyzers' || !def.reveals) {
        ack({ ok: false, error: 'Карточка не найдена' });
        return;
      }
      if (!db.getCards(uid).some((c) => c.cardId === def.id)) {
        ack({ ok: false, error: 'У вас нет карточки «' + def.name + '»' });
        return;
      }
      const gameErr = room.game.useAnalyzerCard(uid, def.reveals);
      if (gameErr) {
        ack({ ok: false, error: gameErr });
        return;
      }
      db.consumeCardByDef(uid, def.id);
      ack({ ok: true });
      broadcast(room);
    }));

    /** Короткая реплика за столом (чат партии) */
    socket.on(C2S.say, guard('game:say', (...args: unknown[]) => {
      const payload = (args[0] ?? {}) as { text?: string };
      withGame(socket, (game) => {
        const err = game.say(uid, String(payload?.text ?? ''));
        if (err) sendError(socket, err);
      });
    }));

    socket.on(C2S.sync, guard('game:sync', (...args: unknown[]) => {
      const payload = (args[0] ?? {}) as { code?: string };
      const ack = ackOf<{ ok: boolean; error?: string }>(...args);
      const code = String(payload?.code ?? '');
      const room = manager.getRoom(code);
      if (!room) {
        ack({ ok: false, error: 'Комната не найдена' });
        return;
      }
      if (!room.members.has(uid)) {
        ack({ ok: false, error: 'Вы не состоите в этой комнате' });
        return;
      }
      socket.data.roomCode = room.code;
      socket.join(chan(room));
      room.onUpdate = () => broadcast(room);
      room.game?.markOnline(uid, true);
      sendPersonalized(socket, room);
      ack({ ok: true });
    }));

    socket.on(C2S.leaveRoom, guard('room:leave', () => {
      const room = findRoomOf(socket);
      if (!room) return;
      socket.data.roomCode = undefined;
      socket.leave(chan(room));
      if (room.game && !room.game.isFinished) {
        room.game.markOnline(uid, false);
        broadcast(room);
        return;
      }
      room.members.delete(uid);
      if (room.members.size === 0) {
        manager.removeRoom(room.code);
        return;
      }
      if (room.hostId === uid) room.hostId = room.members.keys().next().value as string;
      broadcast(room);
    }));

    socket.on('disconnect', () => {
      const room = findRoomOf(socket);
      if (!room) return;
      if (room.game && !room.game.isFinished) {
        // небольшая отсрочка: при быстром переподключении сокета не пугаем «офлайном»
        setTimeout(() => {
          const current = manager.getRoom(room.code);
          if (!current?.game || current.game.isFinished) return;
          const p = current.game.debug().players.find((pl) => pl.id === uid);
          if (p && p.online) return; // игрок успел переподключиться
          current.game.markOnline(uid, false);
          broadcast(current);
        }, 4000);
        return;
      }
      room.members.delete(uid);
      if (room.members.size === 0) {
        manager.removeRoom(room.code);
        return;
      }
      if (room.hostId === uid) room.hostId = room.members.keys().next().value as string;
      broadcast(room);
    });
  });
}
