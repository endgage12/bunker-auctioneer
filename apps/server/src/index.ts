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

const app = express();
app.use(express.json());
app.use(createRestRouter());

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
});
