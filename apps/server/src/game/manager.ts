// Менеджер комнат: жизненный цикл, тик игр, снимок комнаты ожидания
import { randomBytes } from 'node:crypto';
import { GRID_H, GRID_W, MAX_PLAYERS } from '@auctioneer/shared';
import type { PublicGame, RoomInfo } from '@auctioneer/shared';
import type { Game } from './engine';

export interface MemberInfo {
  id: string;
  name: string;
  avatar?: string;
  cash: number;
}

export class Room {
  readonly id: string;
  readonly code: string;
  hostId: string;
  members = new Map<string, MemberInfo>();
  game: Game | null = null;
  state: 'waiting' | 'game' = 'waiting';
  /** вызывается при каждом изменении состояния игры (для рассылки по сокетам) */
  onUpdate: (() => void) | null = null;

  constructor(id: string, code: string, host: MemberInfo) {
    this.id = id;
    this.code = code;
    this.hostId = host.id;
    this.members.set(host.id, host);
  }
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export class Manager {
  private rooms = new Map<string, Room>();
  private timer: ReturnType<typeof setInterval> | null = null;

  createRoom(host: MemberInfo): Room {
    const code = this.genCode();
    const room = new Room(crypto.randomUUID(), code, host);
    this.rooms.set(code, room);
    this.ensureTimer();
    return room;
  }

  getRoom(code: string): Room | undefined {
    return this.rooms.get(code.toUpperCase());
  }

  listRooms(): RoomInfo[] {
    const out: RoomInfo[] = [];
    for (const room of this.rooms.values()) {
      if (room.state !== 'waiting') continue;
      out.push({
        code: room.code,
        players: room.members.size,
        hostName: room.members.get(room.hostId)?.name ?? '—',
      });
    }
    return out;
  }

  removeRoom(code: string): void {
    this.rooms.delete(code.toUpperCase());
  }

  debugRooms(): Room[] {
    return [...this.rooms.values()];
  }

  private genCode(): string {
    for (let i = 0; i < 30; i++) {
      let code = '';
      for (let j = 0; j < 4; j++) code += CODE_ALPHABET[randomBytes(1)[0] % CODE_ALPHABET.length];
      if (!this.rooms.has(code)) return code;
    }
    throw new Error('Не удалось сгенерировать код комнаты');
  }

  private ensureTimer(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      for (const room of this.rooms.values()) {
        if (room.game && !room.game.isFinished) room.game.tick();
      }
    }, 250);
  }
}

export const manager = new Manager();

/** Снимок комнаты в фазе ожидания */
export function waitingSnapshot(room: Room): PublicGame {
  const members = [...room.members.values()];
  return {
    id: room.id,
    code: room.code,
    phase: 'waiting',
    players: members.map((m) => ({
      id: m.id,
      name: m.name,
      avatar: m.avatar,
      cash: m.cash,
      startCash: m.cash,
      ante: 0,
      online: true,
      passed: false,
      bidPlaced: false,
      inventoryValue: 0,
      isHost: m.id === room.hostId,
    })),
    board: { w: GRID_W, h: GRID_H, cells: [], lots: [] },
    items: [],
    auction: null,
    deadline: 0,
    log: [],
  };
}

/** Занятость: можно ли войти в комнату */
export function canJoin(room: Room, userId: string): { ok: boolean; error?: string } {
  if (room.state === 'game' && !room.members.has(userId)) {
    return { ok: false, error: 'Игра уже идёт' };
  }
  if (room.state === 'waiting' && !room.members.has(userId) && room.members.size >= MAX_PLAYERS) {
    return { ok: false, error: 'Комната заполнена' };
  }
  return { ok: true };
}
