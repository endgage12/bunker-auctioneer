// Интеграционная проверка расчёта партии на РЕАЛЬНОМ сервере по Socket.IO.
//
// Юнит-тесты движка проверяют applyWin напрямую. Здесь мы проходим весь путь:
// HTTP-логин → сокет → лобби → вступительные ставки → торги → финализация в БД.
// Ставки задаются принудительно, чтобы гарантированно получить переплату
// (в живых партиях боты почти не переплачивают, и эту ветку иначе не проверить).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import type { Server as HttpServer } from 'node:http';
import { existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { io as ioClient } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import express from 'express';
import { Server } from 'socket.io';
import {C2S, S2C, TIERS} from '@auctioneer/shared';
import type { PublicGame } from '@auctioneer/shared';

/** Плата за вход в медный зал */
const ENTRY = TIERS.bronze.entry;

const TEST_DB = resolve(process.cwd(), '..', '..', 'data', 'test-settlement-e2e.db');

let db: typeof import('../src/db');
let httpServer: HttpServer;
let ioServer: Server;
let port = 0;

beforeAll(async () => {
  for (const f of [TEST_DB, TEST_DB + '-wal', TEST_DB + '-shm']) {
    if (existsSync(f)) rmSync(f, { force: true });
  }
  process.env.DB_PATH = TEST_DB;
  // фазы по 0.3 с: партия проходит за секунды, но весь путь остаётся настоящим
  process.env.GAME_BETTING_SECONDS = '0.3';
  process.env.GAME_REVEAL_SECONDS = '0.3';
  process.env.GAME_BID_SECONDS = '0.3';
  process.env.GAME_RESOLVE_SECONDS = '0.3';
  // Стол ровно на 100 000: ставка победителя гарантированно выше,
  // значит проверяем ветку переплаты и компенсации.
  process.env.GAME_TABLE_VALUE_OVERRIDE = '100000';

  // сервер поднимаем в том же процессе: БД уже указывает на тестовый файл
  const { createRestRouter } = await import('../src/rest');
  const { attachSocket } = await import('../src/socket');
  db = await import('../src/db');

  const app = express();
  app.use(express.json());
  app.use(createRestRouter());
  httpServer = createServer(app);
  ioServer = new Server(httpServer, { cors: { origin: '*' } });
  attachSocket(ioServer);
  await new Promise<void>((r) => httpServer.listen(0, '127.0.0.1', () => r()));
  const addr = httpServer.address();
  port = typeof addr === 'object' && addr ? addr.port : 0;
}, 30_000);

afterAll(async () => {
  ioServer?.close();
  await new Promise<void>((r) => httpServer?.close(() => r()));
  for (const f of [TEST_DB, TEST_DB + '-wal', TEST_DB + '-shm']) {
    if (existsSync(f)) rmSync(f, { force: true });
  }
});

interface TestPlayer {
  id: string;
  name: string;
  socket: Socket;
  state: PublicGame | null;
}

async function loginAndConnect(name: string): Promise<TestPlayer> {
  const res = await fetch('http://127.0.0.1:' + port + '/api/auth/dev-login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: name.toLowerCase().replace(/\s+/g, '-') + '-' + port + '@test.local', name }),
  });
  const body = (await res.json()) as { token: string; profile: { id: string; name: string } };
  const socket = ioClient('http://127.0.0.1:' + port, {
    auth: { token: body.token },
    transports: ['websocket'],
  });
  const player: TestPlayer = { id: body.profile.id, name: body.profile.name, socket, state: null };
  socket.on(S2C.state, (s: PublicGame) => {
    player.state = s;
  });
  await new Promise<void>((r, j) => {
    socket.on('connect', () => r());
    socket.on('connect_error', j);
  });
  return player;
}

function emitAck<T>(p: TestPlayer, event: string, payload: unknown): Promise<T> {
  return new Promise((r) => p.socket.emit(event, payload, (resp: T) => r(resp)));
}

async function waitFor(cond: () => boolean, timeoutMs = 20_000, stepMs = 40): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (cond()) return true;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  return cond();
}

/**
 * Один прогон партии с управляемыми ставками.
 * Ставка ограничена наличными игрока (после взноса это 470 000), поэтому
 * гарантированную переплату даёт только достаточно дешёвый стол — при
 * необходимости прогон повторяется.
 */
/** номер прогона: аккаунты и комнаты не должны пересекаться между попытками */
let runCounter = 0;

async function playControlledGame(): Promise<{
  overpaid: boolean;
  winnerIdx: number;
  paid: number;
  tableValue: number;
  perLoser: number;
  deltas: number[];
  antes: number;
  code: string;
  bankIncome: number | null;
}> {
      const runId = 'r' + ++runCounter + 'u' + Math.floor(Math.random() * 100000);
      const players = await Promise.all([
        loginAndConnect('Сеттл Один ' + runId),
        loginAndConnect('Сеттл Два ' + runId),
        loginAndConnect('Сеттл Три ' + runId),
        loginAndConnect('Сеттл Четыре ' + runId),
      ]);

      // все четверо — в одну комнату
      const first = await emitAck<{ code: string }>(players[0], C2S.play, {});
      for (const p of players.slice(1)) {
        const r = await emitAck<{ code: string; error?: string }>(p, C2S.joinRoom, first.code);
        expect(r.error).toBeUndefined();
      }
      const host = players[0];
      expect(await waitFor(() => host.state?.phase === 'ready')).toBe(true);

      // вступительные ставки
      for (const p of players) p.socket.emit(C2S.ante, { amount: ENTRY });
      expect(await waitFor(() => host.state?.phase === 'auction')).toBe(true);

      // Управляем партией. Раунд 5 — «высшая ставка побеждает безусловно»,
      // поэтому до него не торгуемся (все пасуют), а в 5-м ставим крупно.
      // Ставка ограничена наличными игрока (стартовый капитал минус взнос).
      const bids = [400_000, 120_000, 110_000, 100_000];
      const before = new Map(players.map((p) => [p.id, db.getProfile(p.id)!.cash]));

      let done = false;
      /** победитель АУКЦИОНА (не путать с победителем партии по богатству) */
      let auctionWinnerId: string | null = null;
      let auctionResult: { winnerId?: string; price?: number; compensation?: number } | null = null;
      let countedRound = -1;

      for (let guard = 0; guard < 12_000 && !done; guard++) {
        const snap = host.state;
        if (!snap) break;
        if (snap.auction?.result?.winnerId) {
          auctionWinnerId = snap.auction.result.winnerId;
          auctionResult = snap.auction.result;
        }
        if (snap.phase === 'finished') {
          done = true;
          break;
        }
        const a = snap.auction;
        if (a?.phase === 'bid' && a.round !== countedRound) {
          countedRound = a.round;
          const final = a.round >= 5;
          players.forEach((p, i) => {
            const me = snap.players.find((x) => x.id === p.id);
            if (!me || me.passed) return;
            p.socket.emit(C2S.bid, { amount: final ? bids[i] : 0 });
          });
        }
        await new Promise((r) => setTimeout(r, 20));
      }

      expect(done, 'партия должна завершиться').toBe(true);
      const final = host.state!.final!;
      const tableValue = final.standings.length > 0 ? host.state!.items.reduce((s, i) => s + (i.value ?? 0), 0) : 0;

      // Победителя аукциона определяем по факту: он заплатил взнос И ставку.
      // Не полагаемся на порядок заявок — часть ставок могла не пройти.
      expect(auctionWinnerId, 'аукцион должен определить победителя').toBeTruthy();
      const winnerIdx = players.findIndex((p) => p.id === auctionWinnerId);
      expect(winnerIdx, 'победитель должен быть одним из игроков').toBeGreaterThanOrEqual(0);

      const paid = auctionResult?.price ?? 0;
      expect(paid, 'ставка победителя должна быть положительной').toBeGreaterThan(0);
      const losDeal = paid - tableValue;
      const perLoser = Math.floor(Math.max(0, losDeal) * 0.1);

      // Сверяем ФАКТИЧЕСКИЕ балансы в БД.
      // Победитель: минус взнос и своя ставка.
      const winnerDelta = db.getProfile(players[winnerIdx].id)!.cash - before.get(players[winnerIdx].id)!;
      expect(winnerDelta).toBe(-ENTRY - paid);

      // Проигравшие: минус взнос; при переплате плюс компенсация.
      // Их собственные ставки НЕ списываются — это и есть проверяемое правило.
      const expectedLoserDelta = -ENTRY + (losDeal > 0 ? perLoser : 0);
      for (let i = 0; i < players.length; i++) {
        if (i === winnerIdx) continue;
        const delta = db.getProfile(players[i].id)!.cash - before.get(players[i].id)!;
        expect(delta, 'проигравший ' + players[i].name).toBe(expectedLoserDelta);
      }

      // в журнале банка доход = ставка минус выплаченные компенсации
      const txs = db.getBankTransactions(1, 50).transactions.filter((t) => (t.note ?? '').includes(host.state!.code));
      const gameTx = txs.find((t) => t.type === 'game');
      expect(gameTx, 'должна быть проводка дохода партии').toBeDefined();
      expect(gameTx!.amount).toBe(paid - perLoser * (players.length - 1));

      for (const p of players) p.socket.close();
      return {
        overpaid: losDeal > 0,
        winnerIdx,
        paid,
        tableValue,
        perLoser,
        deltas: players.map((p, i) => after(i)),
        antes: ENTRY,
        code: host.state!.code,
        bankIncome: gameTx ? gameTx.amount : null,
      };

      function after(i: number): number {
        return db.getProfile(players[i].id)!.cash - before.get(players[i].id)!;
      }
}

describe('расчёт партии на реальном сервере: переплата и компенсация', () => {
  it(
    'проигравшие получают по 10% от минуса победителя, ставки проигравших не списываются',
    async () => {
      // стол задан оверрайдом, поэтому переплата гарантирована
      const run = await playControlledGame();
      expect(
        run.overpaid,
        'победитель должен быть в минусе: ставка ' + run.paid + ', стол ' + run.tableValue,
      ).toBe(true);

      const { winnerIdx, paid, tableValue, perLoser, deltas } = run;
      expect(perLoser).toBe(Math.floor((paid - tableValue) * 0.1));
      expect(perLoser).toBeGreaterThan(0);

      deltas.forEach((delta, i) => {
        if (i === winnerIdx) {
          // победитель платит взнос и свою ставку
          expect(delta).toBe(-ENTRY - paid);
        } else {
          // проигравший: минус взнос, плюс компенсация; его ставка НЕ списана
          expect(delta).toBe(-ENTRY + perLoser);
        }
      });

      // в журнале банка доход = ставка минус выплаченные компенсации
      expect(run.bankIncome).toBe(paid - perLoser * (deltas.length - 1));
    },
    120_000,
  );
});
