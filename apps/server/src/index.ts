// Точка входа: HTTP + Socket.IO + статика веб-клиента (если собран)
import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config';
import './db';
import { createRestRouter } from './rest';
import { attachSocket } from './socket';
import { botPool } from './bots/pool';
import { matchmakingSummary } from './bots/metrics';

const app = express();
app.use(express.json());
app.use(createRestRouter());

// Парк ботов — это фоновая нагрузка: её сбой не должен ронять партии живых игроков
process.on('unhandledRejection', (reason) => {
  console.error('[auctioneer] необработанная ошибка (сервер продолжает работу):', reason);
});

const here = dirname(fileURLToPath(import.meta.url));
const webDist = resolve(here, '../../web/dist');
if (existsSync(webDist)) {
  app.use(express.static(webDist));
  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api/')) {
      res.sendFile(resolve(webDist, 'index.html'));
      return;
    }
    next();
  });
}

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: config.webOrigin, credentials: true },
});
attachSocket(io);

httpServer.listen(config.port, () => {
  console.log('[auctioneer] API + WebSocket: http://localhost:' + config.port);
  console.log('[auctioneer] Google OAuth: ' + (config.googleClientId ? 'включён' : 'не настроен'));
  console.log('[auctioneer] Dev-login: ' + (config.allowDevLogin ? 'включён' : 'выключен'));
  console.log('[auctioneer] БД: ' + config.dbPath);

  // Парк ботов: подключается к этому же серверу как обычные клиенты по Socket.IO
  const origin = 'http://127.0.0.1:' + config.port;
  void botPool
    .start(origin, (msg) => console.log('[bots] ' + msg))
    .then(() => {
      if (!botPool.isRunning) return;
      const s = botPool.stats();
      console.log('[auctioneer] Боты: ' + s.total + ' шт. (' + formatCharacters(s.characters) + ')');
      console.log('[auctioneer] Цель: ожидание лобби не больше 30 секунд (см. /api/bots/stats)');
    })
    .catch((err) => console.error('[bots] не удалось запустить парк ботов:', err));

  // Периодический отчёт по SLA ожидания лобби
  setInterval(() => {
    if (!botPool.isRunning) return;
    console.log('[bots] ' + matchmakingSummary());
  }, 60_000).unref();
});

function formatCharacters(counts: Record<string, number>): string {
  return Object.entries(counts)
    .map(([name, n]) => name + ' ' + n)
    .join(', ');
}
