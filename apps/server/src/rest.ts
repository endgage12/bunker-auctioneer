// REST API: профиль, комнаты, авторизация (Google OAuth + dev-login)
import { Router } from 'express';
import type { Request } from 'express';
import { config } from './config';
import * as db from './db';
import { authRequired, consumeOauthState, exchangeGoogleCode, googleAuthUrl, passwordAccounts, registerFailedLogin, resetLoginAttempts, safeEqual, signToken } from './auth';
import type { AuthRequest } from './auth';
import { manager } from './game/manager';
import { botPool } from './bots/pool';

export function createRestRouter(): Router {
  const r = Router();

  r.get('/api/health', (_req, res) => {
    // allowDevLogin нужен клиенту, чтобы не показывать тестовые кнопки в проде
    res.json({ ok: true, allowDevLogin: config.allowDevLogin, googleOAuth: !!config.googleClientId });
  });

  r.get('/api/me', authRequired, (req, res) => {
    const userId = (req as AuthRequest).userId;
    const profile = userId ? db.getProfile(userId) : null;
    if (!profile) {
      res.status(404).json({ error: 'Пользователь не найден' });
      return;
    }
    res.json(profile);
  });

  r.get('/api/rooms', authRequired, (_req, res) => {
    res.json(manager.listRooms());
  });

  // ---------- профили игроков ----------

  r.get('/api/profile/:id', authRequired, (req, res) => {
    const userId = String(req.params.id ?? '');
    const profile = userId ? db.getPublicProfile(userId) : null;
    if (!profile) {
      res.status(404).json({ error: 'Игрок не найден' });
      return;
    }
    res.json(profile);
  });

  // ---------- таблица лидеров ----------

  // топ игроков по «счёту» (наличные + номинал инвентаря); me — место текущего игрока.
  // Пагинация: page (с 1), pageSize (по умолчанию 30).
  r.get('/api/leaderboard', authRequired, (req, res) => {
    const userId = (req as AuthRequest).userId ?? '';
    const q = req.query as Record<string, string | undefined>;
    // includeBots=0 — топ только из живых игроков (боты по умолчанию показываются)
    const includeBots = q.includeBots !== '0' && q.includeBots !== 'false';
    res.json(db.getLeaderboard(Number(q.page ?? 1), Number(q.pageSize ?? 30), userId, includeBots));
  });

  /** Витрина залов: сколько игроков ждёт в каждом зале (для главного экрана) */
  r.get('/api/rooms/tiers', authRequired, (_req, res) => {
    res.json(manager.listRoomsByTier());
  });

  /** Состояние парка ботов и метрики матчмейкинга (для отладки и контроля SLA) */
  r.get('/api/bots/stats', authRequired, (_req, res) => {
    res.json({ ...botPool.stats(), matchmaking: botPool.metrics(), phases: botPool.debugBreakdown() });
  });

  // история матчей игрока (вложения и разница по каждой партии)
  r.get('/api/profile/:id/history', authRequired, (req, res) => {
    const userId = String(req.params.id ?? '');
    const profile = userId ? db.getPublicProfile(userId) : null;
    if (!profile) {
      res.status(404).json({ error: 'Игрок не найден' });
      return;
    }
    res.json(db.getMatchHistory(userId));
  });

  // детализация матча: участники и предметы призового стола (модалка истории)
  r.get('/api/game/:id', authRequired, (req, res) => {
    const detail = db.getGameDetail(String(req.params.id ?? ''));
    if (!detail) {
      res.status(404).json({ error: 'Матч не найден' });
      return;
    }
    res.json(detail);
  });

  // ---------- барахолка и торговец ----------

  r.get('/api/market', authRequired, (req, res) => {
    const userId = (req as AuthRequest).userId ?? '';
    res.json(db.getMarketListings(userId));
  });

  r.get('/api/market/history', authRequired, (req, res) => {
    const userId = (req as AuthRequest).userId ?? '';
    res.json(db.getMarketHistory(userId));
  });

  r.post('/api/market/list', authRequired, (req, res) => {
    const userId = (req as AuthRequest).userId ?? '';
    const body = (req.body ?? {}) as { itemId?: string; price?: number };
    const result = db.createListing(userId, String(body.itemId ?? ''), Number(body.price ?? 0));
    if (!result.ok) {
      res.status(400).json({ error: result.error ?? 'Ошибка' });
      return;
    }
    res.json({ ok: true });
  });

  r.post('/api/market/buy', authRequired, (req, res) => {
    const userId = (req as AuthRequest).userId ?? '';
    const body = (req.body ?? {}) as { listingId?: string };
    const result = db.buyListing(userId, String(body.listingId ?? ''));
    if (!result.ok) {
      res.status(400).json({ error: result.error ?? 'Ошибка' });
      return;
    }
    res.json({ ok: true });
  });

  r.post('/api/market/cancel', authRequired, (req, res) => {
    const userId = (req as AuthRequest).userId ?? '';
    const body = (req.body ?? {}) as { listingId?: string };
    const result = db.cancelListing(userId, String(body.listingId ?? ''));
    if (!result.ok) {
      res.status(400).json({ error: result.error ?? 'Ошибка' });
      return;
    }
    res.json({ ok: true });
  });

  r.post('/api/items/sell', authRequired, (req, res) => {
    const userId = (req as AuthRequest).userId ?? '';
    const body = (req.body ?? {}) as { itemId?: string };
    const result = db.sellToVendor(userId, String(body.itemId ?? ''));
    if (!result.ok) {
      res.status(400).json({ error: result.error ?? 'Ошибка' });
      return;
    }
    res.json({ ok: true, value: result.value ?? 0 });
  });

  r.post('/api/items/sell-all', authRequired, (req, res) => {
    const userId = (req as AuthRequest).userId ?? '';
    const result = db.sellAllToVendor(userId);
    if (!result.ok) {
      res.status(400).json({ error: result.error ?? 'Ошибка' });
      return;
    }
    res.json({ ok: true, value: result.value ?? 0, count: result.count ?? 0 });
  });


  r.post('/api/items/move', authRequired, (req, res) => {
    const userId = (req as AuthRequest).userId ?? '';
    const body = (req.body ?? {}) as { itemId?: string; x?: number; y?: number };
    const result = db.moveInventoryItem(userId, String(body.itemId ?? ''), Number(body.x ?? -1), Number(body.y ?? -1));
    if (!result.ok) {
      res.status(400).json({ error: result.error ?? 'Ошибка' });
      return;
    }
    res.json({ ok: true });
  });

  r.post('/api/items/sort', authRequired, (req, res) => {
    const userId = (req as AuthRequest).userId ?? '';
    const result = db.sortInventory(userId);
    if (!result.ok) {
      res.status(400).json({ error: result.error ?? 'Ошибка' });
      return;
    }
    res.json({ ok: true });
  });

  // ---------- Тайный Санта ----------

  r.get('/api/santa', authRequired, (req, res) => {
    const userId = (req as AuthRequest).userId ?? '';
    res.json(db.getSanta(userId));
  });

  r.post('/api/santa/sacrifice', authRequired, (req, res) => {
    const userId = (req as AuthRequest).userId ?? '';
    const body = (req.body ?? {}) as { itemId?: string; x?: number; y?: number };
    const result = db.sacrificeToSanta(userId, String(body.itemId ?? ''), body.x, body.y);
    if (!result.ok) {
      res.status(400).json({ error: result.error ?? 'Ошибка' });
      return;
    }
    res.json({ ok: true });
  });

  r.post('/api/santa/take', authRequired, (req, res) => {
    const userId = (req as AuthRequest).userId ?? '';
    const body = (req.body ?? {}) as { itemId?: string; x?: number; y?: number };
    const result = db.takeFromSanta(userId, String(body.itemId ?? ''), body.x, body.y);
    if (!result.ok) {
      res.status(400).json({ error: result.error ?? 'Ошибка' });
      return;
    }
    res.json({ ok: true });
  });

  // ---------- Магазин и особые карточки ----------

  r.get('/api/shop', authRequired, (req, res) => {
    const userId = (req as AuthRequest).userId ?? '';
    res.json(db.getShopState(userId));
  });

  r.post('/api/shop/spin', authRequired, (req, res) => {
    const userId = (req as AuthRequest).userId ?? '';
    const result = db.spinWheel(userId);
    if (!result.ok) {
      res.status(400).json({ error: result.error ?? 'Ошибка' });
      return;
    }
    res.json(result);
  });

  r.get('/api/cards', authRequired, (req, res) => {
    const userId = (req as AuthRequest).userId ?? '';
    res.json(db.getCards(userId));
  });

  r.post('/api/cards/amplify', authRequired, (req, res) => {
    const userId = (req as AuthRequest).userId ?? '';
    const body = (req.body ?? {}) as { cardId?: string };
    const result = db.amplifyItem(userId, String(body.cardId ?? ''));
    if (!result.ok) {
      res.status(400).json({ error: result.error ?? 'Ошибка' });
      return;
    }
    res.json({ ok: true, removed: result.removed, item: result.item });
  });

  r.get('/api/debug/rooms', (_req, res) => {
    if (!config.allowDevLogin) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    res.json(
      manager.debugRooms().map((room) => {
        const g = room.game;
        if (!g) return { code: room.code, state: room.state, game: null };
        const dbg = g.debug();
        return {
          code: room.code,
          state: room.state,
          game: {
            phase: g.phase,
            deadline: g.deadline,
            now: Date.now(),
            left: g.deadline - Date.now(),
            players: dbg.players.map((p) => {
              return {
                id: p.id.slice(0, 8),
                inv: p.inventory.length,
                ante: p.ante,
              };
            }),
            placed: dbg.placed.length,
            pot: dbg.pot,
          },
        };
      }),
    );
  });

  // ---------- авторизация ----------

  r.post('/api/auth/dev-login', (req, res) => {
    if (!config.allowDevLogin) {
      res.status(403).json({ error: 'Dev-login отключён (ALLOW_DEV_LOGIN=false)' });
      return;
    }
    const body = (req.body ?? {}) as { email?: string; name?: string };
    const email = String(body.email ?? '').trim().toLowerCase();
    if (!email.includes('@')) {
      res.status(400).json({ error: 'Укажите корректный email' });
      return;
    }
    const name = String(body.name ?? '').trim() || email.split('@')[0];
    const user = db.findOrCreateDevUser(email, name);
    void signToken(user.id).then((token) => {
      res.json({ token, profile: db.getProfile(user.id) });
    });
  });

  // Тестовый вход администратора банка дома (кнопка «Войти (admin)»)
  r.post('/api/auth/admin-login', (_req, res) => {
    if (!config.allowDevLogin) {
      res.status(403).json({ error: 'Вход администратора отключён (ALLOW_DEV_LOGIN=false)' });
      return;
    }
    const user = db.findOrCreateAdminUser();
    void signToken(user.id).then((token) => {
      res.json({ token, profile: db.getProfile(user.id) });
    });
  });

  /**
   * Вход по паролю для личных аккаунтов (кнопка «Войти как shlepafloppa»).
   * Пароль сравнивается ТОЛЬКО на сервере (значение из env), в клиент не попадает.
   * Неудачные попытки throttl'ятся, чтобы пароль нельзя было подобрать перебором.
   */
  r.post('/api/auth/password-login', (req, res) => {
    if (!config.allowDevLogin) {
      res.status(403).json({ error: 'Вход по паролю отключён (ALLOW_DEV_LOGIN=false)' });
      return;
    }
    const key = String(req.ip ?? 'unknown') + '|password-login';
    const body = (req.body ?? {}) as { account?: string; password?: string };
    const wanted = String(body.account ?? '').trim().toLowerCase();
    const password = String(body.password ?? '');
    const account = passwordAccounts().find((a) => a.email === wanted || a.name.toLowerCase() === wanted);
    // верный пароль проверяем первым: иначе перебором можно было бы запереть владельца аккаунта
    const ok = !!account && safeEqual(password, account.password);
    if (!ok) {
      // аккаунт не найден — считаем так же, как неверный пароль (не подсказываем, что логин верный)
      const delay = registerFailedLogin(key);
      setTimeout(() => {
        res.status(401).json({ error: 'Неверный пароль' });
      }, Math.min(delay, 3000));
      return;
    }
    resetLoginAttempts(key);
    const user = db.findOrCreatePersonalUser(account.email, account.name);
    void signToken(user.id).then((token) => {
      res.json({ token, profile: db.getProfile(user.id) });
    });
  });

  r.get('/api/auth/google', (_req, res) => {
    if (!config.googleClientId || !config.googleClientSecret) {
      res.status(503).json({ error: 'Google OAuth не настроен: задайте GOOGLE_CLIENT_ID и GOOGLE_CLIENT_SECRET' });
      return;
    }
    res.redirect(googleAuthUrl());
  });

  r.get('/api/auth/google/callback', (req, res) => {
    const q = req.query as Record<string, string | undefined>;
    const code = q.code;
    const state = q.state;
    if (q.error || !code || !state || !consumeOauthState(state)) {
      res.redirect(config.webOrigin + '/#/login?error=oauth');
      return;
    }
    void (async () => {
      const info = await exchangeGoogleCode(code);
      if (!info) {
        res.redirect(config.webOrigin + '/#/login?error=oauth');
        return;
      }
      const user = db.upsertGoogleUser(info);
      const token = await signToken(user.id);
      res.redirect(config.webOrigin + '/#/login?token=' + token);
    })();
  });

  // ---------- банк дома (админ) ----------

  function isAdminReq(req: Request): boolean {
    const userId = (req as AuthRequest).userId ?? '';
    const profile = userId ? db.getProfile(userId) : null;
    return !!profile?.isAdmin;
  }

  r.get('/api/admin/bank', authRequired, (req, res) => {
    if (!isAdminReq(req)) {
      res.status(403).json({ error: 'Нужны права администратора' });
      return;
    }
    res.json(db.getAdminBank());
  });

  r.get('/api/admin/bank/transactions', authRequired, (req, res) => {
    if (!isAdminReq(req)) {
      res.status(403).json({ error: 'Нужны права администратора' });
      return;
    }
    const q = req.query as Record<string, string | undefined>;
    res.json(db.getBankTransactions(Number(q.page ?? 1), Number(q.pageSize ?? 30)));
  });

  r.post('/api/admin/bank/deposit', authRequired, (req, res) => {
    if (!isAdminReq(req)) {
      res.status(403).json({ error: 'Нужны права администратора' });
      return;
    }
    const userId = (req as AuthRequest).userId ?? '';
    const body = (req.body ?? {}) as { amount?: number };
    const result = db.depositBank(userId, Number(body.amount ?? 0));
    if (!result.ok) {
      res.status(400).json({ error: result.error ?? 'Ошибка' });
      return;
    }
    res.json({ ok: true });
  });

  r.post('/api/admin/bank/transfer', authRequired, (req, res) => {
    if (!isAdminReq(req)) {
      res.status(403).json({ error: 'Нужны права администратора' });
      return;
    }
    const userId = (req as AuthRequest).userId ?? '';
    const body = (req.body ?? {}) as { email?: string; amount?: number };
    const result = db.transferFromBank(userId, String(body.email ?? ''), Number(body.amount ?? 0));
    if (!result.ok) {
      res.status(400).json({ error: result.error ?? 'Ошибка' });
      return;
    }
    res.json({ ok: true });
  });

  r.post('/api/admin/market/list', authRequired, (req, res) => {
    if (!isAdminReq(req)) {
      res.status(403).json({ error: 'Нужны права администратора' });
      return;
    }
    const body = (req.body ?? {}) as { itemId?: string; price?: number };
    const result = db.adminListHouseItem(String(body.itemId ?? ''), Number(body.price ?? 0));
    if (!result.ok) {
      res.status(400).json({ error: result.error ?? 'Ошибка' });
      return;
    }
    res.json({ ok: true });
  });

  // ---------- убежище и сеты ----------

  r.get('/api/hideout', authRequired, (req, res) => {
    const userId = (req as AuthRequest).userId ?? '';
    res.json(db.getHideout(userId));
  });

  r.post('/api/hideout/place', authRequired, (req, res) => {
    const userId = (req as AuthRequest).userId ?? '';
    const body = (req.body ?? {}) as { setId?: string; itemId?: string };
    const result = db.placeShowcaseItem(userId, String(body.setId ?? ''), String(body.itemId ?? ''));
    if (!result.ok) {
      res.status(400).json({ error: result.error ?? 'Ошибка' });
      return;
    }
    res.json({ ok: true });
  });

  r.post('/api/hideout/remove', authRequired, (req, res) => {
    const userId = (req as AuthRequest).userId ?? '';
    const body = (req.body ?? {}) as { itemId?: string };
    const result = db.removeShowcaseItem(userId, String(body.itemId ?? ''));
    if (!result.ok) {
      res.status(400).json({ error: result.error ?? 'Ошибка' });
      return;
    }
    res.json({ ok: true });
  });

  r.post('/api/hideout/transmute', authRequired, (req, res) => {
    const userId = (req as AuthRequest).userId ?? '';
    const result = db.transmute(userId);
    if (!result.ok) {
      res.status(400).json({ error: result.error ?? 'Ошибка' });
      return;
    }
    res.json({ ok: true, item: result.item });
  });

  r.post('/api/admin/items/grant', authRequired, (req, res) => {
    if (!isAdminReq(req)) {
      res.status(403).json({ error: 'Нужны права администратора' });
      return;
    }
    const body = (req.body ?? {}) as { email?: string; defId?: string };
    const result = db.adminGrantItem(String(body.email ?? ''), String(body.defId ?? ''));
    if (!result.ok) {
      res.status(400).json({ error: result.error ?? 'Ошибка' });
      return;
    }
    res.json({ ok: true, item: result.item });
  });

  return r;
}
