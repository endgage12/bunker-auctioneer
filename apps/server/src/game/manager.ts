// Менеджер комнат: жизненный цикл, тик игр, снимок комнаты ожидания
import { randomBytes } from 'node:crypto';
import { DEFAULT_TIER, GRID_H, GRID_W, MAX_PLAYERS } from '@auctioneer/shared';
import type { PublicGame, RoomInfo, TierDef, TierId } from '@auctioneer/shared';
import type { Game } from './engine';

export interface MemberInfo {
  id: string;
  name: string;
  avatar?: string;
  cash: number;
  /** нажал ли «Я готов/а» в комнате ожидания */
  ready: boolean;
}

export class Room {
  readonly id: string;
  readonly code: string;
  /** зал казино: определяет плату за вход и ценность стола */
  readonly tier: TierDef;
  hostId: string;
  members = new Map<string, MemberInfo>();
  game: Game | null = null;
  state: 'waiting' | 'game' = 'waiting';
  /** когда комната появилась — используется для метрики ожидания лобби */
  readonly waitingSince: number = Date.now();
  /** вызывается при каждом изменении состояния игры (для рассылки по сокетам) */
  onUpdate: (() => void) | null = null;

  constructor(id: string, code: string, host: MemberInfo, tier: TierDef = DEFAULT_TIER) {
    this.id = id;
    this.code = code;
    this.tier = tier;
    this.hostId = host.id;
    this.members.set(host.id, host);
  }
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export class Manager {
  private rooms = new Map<string, Room>();
  private timer: ReturnType<typeof setInterval> | null = null;

  createRoom(host: MemberInfo, tier: TierDef = DEFAULT_TIER): Room {
    const code = this.genCode();
    const room = new Room(crypto.randomUUID(), code, host, tier);
    this.rooms.set(code, room);
    this.ensureTimer();
    return room;
  }

  getRoom(code: string): Room | undefined {
    return this.rooms.get(code.toUpperCase());
  }

  /** Комната ожидания, в которой уже состоит игрок (для быстрого подбора) */
  findWaitingRoomOf(userId: string): Room | undefined {
    for (const room of this.rooms.values()) {
      if (room.state === 'waiting' && room.members.has(userId)) return room;
    }
    return undefined;
  }

  /**
   * Ближайшая к старту свободная комната для быстрого подбора:
   * комната ожидания с наибольшим числом игроков (при равенстве — созданная раньше).
   */
  pickQuickRoom(tierId?: string): Room | undefined {
    let best: Room | undefined;
    for (const room of this.rooms.values()) {
      if (room.state !== 'waiting') continue;
      if (room.members.size >= MAX_PLAYERS) continue;
      // Залы не смешиваются: игрок попадает только в свой зал
      if (tierId && room.tier.id !== tierId) continue;
      if (!best || room.members.size > best.members.size) best = room;
    }
    return best;
  }

  /** Комнаты ожидания конкретного зала (для витрины залов в лобби) */
  listRoomsByTier(): Record<string, { waiting: number; players: number }> {
    const out: Record<string, { waiting: number; players: number }> = {};
    for (const room of this.rooms.values()) {
      if (room.state !== 'waiting') continue;
      const key = room.tier.id;
      const entry = out[key] ?? { waiting: 0, players: 0 };
      entry.waiting += 1;
      entry.players += room.members.size;
      out[key] = entry;
    }
    return out;
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
      ready: m.ready,
    })),
    board: { w: GRID_W, h: GRID_H, cells: [], lots: [] },
    items: [],
    auction: null,
    deadline: 0,
    log: [],
    tier: {
      id: room.tier.id,
      name: room.tier.name,
      tagline: room.tier.tagline,
      entry: room.tier.entry,
      tableMin: room.tier.tableMin,
      tableMax: room.tier.tableMax,
      color: room.tier.color,
      icon: room.tier.icon,
    },
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
