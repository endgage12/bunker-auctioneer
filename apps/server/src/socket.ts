// Socket.IO: комнаты, игровые действия, рассылка состояний
import type { Server, Socket } from 'socket.io';
import { C2S, S2C, MIN_PLAYERS } from '@auctioneer/shared';
import * as db from './db';
import { canJoin, manager, waitingSnapshot } from './game/manager';
import type { Room } from './game/manager';
import { Game } from './game/engine';
import type { EnginePlayerSeed } from './game/engine';
import { verifyToken } from './auth';
import { config } from './config';

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

function sendPersonalized(socket: SockLite, room: Room): void {
  const snap = roomSnap(room);
  if (room.game) {
    const priv = room.game.personalSnapshot(socket.data.userId as string);
    if (priv) {
      socket.emit(S2C.state, { ...snap, private: priv });
      return;
    }
  }
  socket.emit(S2C.state, snap);
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
  const seeds: EnginePlayerSeed[] = [...room.members.values()].map((m) => {
    const profile = db.getProfile(m.id);
    const bonuses = db.getActiveSetBonuses(m.id);
    playerBonuses[m.id] = bonuses;
    const cashBonus = bonuses.includes('start_cash_bonus') ? 1.1 : 1;
    return {
      id: m.id,
      name: m.name,
      avatar: m.avatar,
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
  broadcast(room);
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

    socket.on(C2S.createRoom, (ack?: (resp: { code: string } | { error: string }) => void) => {
      const profile = db.getProfile(uid);
      if (!profile) {
        ack?.({ error: 'Пользователь не найден' });
        return;
      }
      const room = manager.createRoom({ id: profile.id, name: profile.name, avatar: profile.avatar, cash: profile.cash });
      socket.data.roomCode = room.code;
      socket.join(chan(room));
      room.onUpdate = () => broadcast(room);
      ack?.({ code: room.code });
      broadcast(room);
    });

    socket.on(C2S.joinRoom, (code: string, ack?: (resp: { code: string } | { error: string }) => void) => {
      const room = manager.getRoom(String(code ?? ''));
      if (!room) {
        ack?.({ error: 'Комната не найдена' });
        return;
      }
      const check = canJoin(room, uid);
      if (!check.ok) {
        ack?.({ error: check.error ?? 'Нельзя войти' });
        return;
      }
      const profile = db.getProfile(uid);
      if (!profile) {
        ack?.({ error: 'Пользователь не найден' });
        return;
      }
      if (!room.members.has(uid)) {
        room.members.set(uid, { id: profile.id, name: profile.name, avatar: profile.avatar, cash: profile.cash });
      }
      socket.data.roomCode = room.code;
      socket.join(chan(room));
      room.onUpdate = () => broadcast(room);
      room.game?.markOnline(uid, true);
      ack?.({ code: room.code });
      broadcast(room);
    });

    socket.on(C2S.start, () => {
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
    });

    socket.on(C2S.ante, (payload: { amount: number }) => {
      withGame(socket, (game) => {
        const err = game.submitAnte(uid, Number(payload.amount));
        if (err) sendError(socket, err);
      });
    });

    socket.on(C2S.bid, (payload: { amount: number }) => {
      withGame(socket, (game) => {
        const err = game.submitBid(uid, Number(payload.amount));
        if (err) sendError(socket, err);
      });
    });

    socket.on(C2S.sync, (payload: { code?: string }) => {
      const room = manager.getRoom(String(payload?.code ?? ''));
      if (room && room.members.has(uid)) {
        socket.data.roomCode = room.code;
        socket.join(chan(room));
        room.onUpdate = () => broadcast(room);
        room.game?.markOnline(uid, true);
        sendPersonalized(socket, room);
      }
    });

    socket.on(C2S.leaveRoom, () => {
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
    });

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
