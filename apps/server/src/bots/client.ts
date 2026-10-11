// Клиент бота: подключение по обычному Socket.IO с JWT.
//
// ВАЖНО (честность): бот получает ровно то же, что и человек — снимок состояния
// из события `state` и ответы на свои действия. Никакого доступа к внутреннему
// состоянию движка (revealOrder, скрытые placed, rng, чужие слепые ставки) у
// ботов нет: они физически не импортируют engine/manager, а работают через сокет.
import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import { C2S, S2C } from '@auctioneer/shared';
import type { PublicGame, PublicPlayer } from '@auctioneer/shared';

export interface BotSocketHandlers {
  onState: (state: PublicGame) => void;
  onError?: (message: string) => void;
}

/** Снимок партии, каким его видит бот (тот же тип, что у человека) */
export type BotView = PublicGame;

export class BotClient {
  private socket: Socket | null = null;
  private state: PublicGame | null = null;

  constructor(
    private readonly apiOrigin: string,
    private readonly token: string,
    private readonly handlers: BotSocketHandlers,
  ) {}

  get connected(): boolean {
    return !!this.socket?.connected;
  }

  /** Последний полученный снимок состояния */
  get snapshot(): PublicGame | null {
    return this.state;
  }

  private myId: string | null = null;

  connect(timeoutMs = 10_000): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = io(this.apiOrigin, {
        auth: { token: this.token },
        transports: ['websocket'],
        reconnection: true,
        reconnectionDelay: 500,
      });
      this.socket = socket;
      const timer = setTimeout(() => {
        socket.close();
        reject(new Error('Таймаут подключения бота к сокету'));
      }, timeoutMs);
      socket.on('connect', () => {
        clearTimeout(timer);
        resolve();
      });
      socket.on('connect_error', (err: Error) => {
        clearTimeout(timer);
        reject(err);
      });
      socket.on(S2C.state, (payload: PublicGame) => {
        try {
          this.state = payload;
          this.handlers.onState(payload);
        } catch (err) {
          // сбой в логике бота не должен ронять сервер
          this.handlers.onError?.('ошибка обработки состояния: ' + (err as Error).message);
        }
      });
      socket.on(S2C.error, (payload: { message?: string }) => {
        try {
          this.handlers.onError?.(String(payload?.message ?? 'ошибка'));
        } catch {
          /* игнорируем */
        }
      });
    });
  }

  disconnect(): void {
    this.socket?.close();
    this.socket = null;
    this.state = null;
  }

  /** Запомнить свой id в партии (по имени профиля бот знает себя в снимке) */
  setMyId(id: string): void {
    this.myId = id;
  }

  /** Найти себя в снимке партии — по id профиля */
  me(state: PublicGame | null = this.state): PublicPlayer | null {
    if (!state || !this.myId) return null;
    return state.players.find((p) => p.id === this.myId) ?? null;
  }

  /** Отметить мою заявку на подбор лобби (для метрик ожидания) */
  noteMatchRequest(): void {
    this.matchRequestedAt = Date.now();
  }

  private matchRequestedAt = 0;

  get matchRequestedAtMs(): number {
    return this.matchRequestedAt;
  }

  /**
   * Запрос с подтверждением. Отсутствие ответа (сервер перезапустился, комната
   * исчезла) — это не повод падать: возвращаем ошибку, бот попробует снова.
   */
  private emitAck<T extends { error?: string }>(event: string, payload: unknown): Promise<T> {
    return new Promise((resolve) => {
      if (!this.socket) {
        resolve({ error: 'Сокет не подключён' } as T);
        return;
      }
      let done = false;
      const finish = (resp: T) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(resp);
      };
      const timer = setTimeout(() => finish({ error: 'Таймаут ответа сервера: ' + event } as T), 8000);
      try {
        (this.socket as unknown as { emit: (e: string, p: unknown, cb: (r: T) => void) => void }).emit(
          event,
          payload,
          (resp: T) => finish(resp ?? ({ error: 'Пустой ответ сервера' } as T)),
        );
      } catch (err) {
        finish({ error: (err as Error).message } as T);
      }
    });
  }

  /** «Играть» в выбранном зале: ближайшее свободное лобби этого зала или новое */
  async play(tier?: string): Promise<{ code: string } | { error: string }> {
    // payload обязателен: socket.io не донесёт ack, если передать undefined
    return this.emitAck<{ code?: string; error?: string }>(C2S.play, { tier }) as Promise<
      { code: string } | { error: string }
    >;
  }

  async joinRoom(code: string): Promise<{ code: string } | { error: string }> {
    return this.emitAck<{ code?: string; error?: string }>(C2S.joinRoom, code) as Promise<
      { code: string } | { error: string }
    >;
  }

  async sync(code: string): Promise<{ ok: boolean; error?: string }> {
    return this.emitAck<{ ok: boolean; error?: string }>(C2S.sync, { code });
  }

  ready(ready: boolean): void {
    this.socket?.emit(C2S.ready, { ready });
  }

  ante(amount: number): void {
    this.socket?.emit(C2S.ante, { amount });
  }

  bid(amount: number): void {
    this.socket?.emit(C2S.bid, { amount });
  }

  say(text: string): void {
    this.socket?.emit(C2S.say, { text });
  }

  useCard(cardId: string): Promise<{ ok: boolean; error?: string }> {
    return this.emitAck<{ ok: boolean; error?: string }>(C2S.useCard, { cardId });
  }

  leaveRoom(): void {
    this.socket?.emit(C2S.leaveRoom);
  }
}
