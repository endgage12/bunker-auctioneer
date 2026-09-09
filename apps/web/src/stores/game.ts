import { defineStore } from 'pinia';
import { C2S, S2C } from '@auctioneer/shared';
import type { PublicGame, PublicPlayer } from '@auctioneer/shared';
import type { Socket } from 'socket.io-client';
import { closeSocket, getSocket } from '../lib/socket';
import { useAuthStore } from './auth';

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error';
}

let toastId = 0;

export const useGameStore = defineStore('game', {
  state: () => ({
    socket: null as Socket | null,
    game: null as PublicGame | null,
    selectedItemId: null as string | null,
    rotated: false,
    toasts: [] as Toast[],
  }),
  getters: {
    meId: () => useAuthStore().meId,
    myPlayer(): PublicPlayer | null {
      if (!this.game) return null;
      return this.game.players.find((p) => p.id === this.meId) ?? null;
    },
  },
  actions: {
    attach(): void {
      const auth = useAuthStore();
      if (!auth.token) return;
      this.socket = getSocket(auth.token);
      this.socket.on(S2C.state, (snap: PublicGame) => {
        this.game = snap;
      });
      this.socket.on(S2C.error, (err: { message?: string }) => {
        this.pushToast(err?.message ?? 'Ошибка', 'error');
      });
      // при переподключении сокета сервер теряет членство в комнате —
      // восстанавливаем его автоматически (фикс «игрок офлайн» и мёртвых ставок)
      this.socket.on('connect', () => {
        if (this.game?.code) this.sync(this.game.code);
      });
    },
    detach(): void {
      closeSocket();
      this.socket = null;
      this.game = null;
      this.selectedItemId = null;
      this.rotated = false;
    },
    pushToast(text: string, kind: 'info' | 'error' = 'info'): void {
      const id = ++toastId;
      this.toasts.push({ id, text, kind });
      setTimeout(() => {
        this.toasts = this.toasts.filter((t) => t.id !== id);
      }, 4000);
    },
    emitAck<T>(event: string, ...args: unknown[]): Promise<T> {
      return new Promise((resolve) => {
        this.socket?.emit(event, ...args, (resp: T) => resolve(resp));
      });
    },
    createRoom(): Promise<{ code: string } | { error: string }> {
      return this.emitAck(C2S.createRoom);
    },
    joinRoom(code: string): Promise<{ code: string } | { error: string }> {
      return this.emitAck(C2S.joinRoom, code);
    },
    /** Быстрый подбор: ближайшая свободная комната или новая */
    play(): Promise<{ code: string } | { error: string }> {
      return this.emitAck(C2S.play);
    },
    setReady(ready: boolean): void {
      this.socket?.emit(C2S.ready, { ready });
    },
    start(): void {
      this.socket?.emit(C2S.start);
    },
    ante(amount: number): void {
      this.socket?.emit(C2S.ante, { amount });
    },
    bid(amount: number): void {
      this.socket?.emit(C2S.bid, { amount });
    },
    /** Применить карточку-анализатор в партии (с подтверждением сервера) */
    useCard(cardId: string): Promise<{ ok: boolean; error?: string }> {
      return this.emitAck(C2S.useCard, { cardId });
    },
    sync(code: string): Promise<{ ok: boolean; error?: string }> {
      if (!this.socket) {
        return Promise.resolve({ ok: false, error: 'Нет соединения с сервером' });
      }
      return this.emitAck<{ ok: boolean; error?: string }>(C2S.sync, { code });
    },
    leave(): void {
      this.socket?.emit(C2S.leaveRoom);
      this.detach();
    },
  },
});
