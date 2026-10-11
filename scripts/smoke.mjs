// E2E smoke-тест: 4 бота играют полную партию через реальный API + WebSocket
import { io } from 'socket.io-client';

const API = process.env.API_URL ?? 'http://localhost:3000';
const N = 4;
const users = [];

function log(...args) {
  console.log('[smoke]', ...args);
}

process.on('uncaughtException', (e) => {
  console.error('[smoke] UNCAUGHT:', e && e.stack ? e.stack : e);
  process.exit(1);
});
process.on('unhandledRejection', (e) => {
  console.error('[smoke] UNHANDLED REJECTION:', e && e.stack ? e.stack : e);
  process.exit(1);
});

function rnd(a, b) {
  return Math.floor(Math.random() * (b - a + 1)) + a;
}

async function api(path, init) {
  const res = await fetch(API + path, init);
  if (!res.ok) {
    let msg = 'HTTP ' + res.status + ' ' + path;
    try {
      const b = await res.json();
      if (b && b.error) msg += ': ' + b.error;
    } catch {
      /* нет тела */
    }
    throw new Error(msg);
  }
  return res.json();
}

async function devLogin(i) {
  const email = 'smoke' + Date.now() + '_' + i + '@test.local';
  const resp = await api('/api/auth/dev-login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, name: 'Smoke ' + i }),
  });
  if (!resp.token || !resp.profile) throw new Error('dev-login вернул пустой ответ: ' + JSON.stringify(resp));
  if (!resp.profile.inventory || resp.profile.inventory.length === 0) {
    throw new Error('у игрока ' + email + ' пустой инвентарь');
  }
  return { ...resp, email };
}

function emitAck(sock, event, ...args) {
  return new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error('нет ack на ' + event + ' за 10с')), 10000);
    sock.emit(event, ...args, (resp) => {
      clearTimeout(to);
      resolve(resp);
    });
  });
}

async function main() {
  log('Вход ' + N + ' игроков…');
  for (let i = 0; i < N; i++) {
    const u = await devLogin(i);
    users.push(u);
    log('  игрок ' + i + ': ' + u.profile.name + ', предметов ' + u.profile.inventory.length + ', наличные ' + u.profile.cash);
  }

  const socks = [];
  const latest = users.map(() => null);

  log('Подключение сокетов…');
  for (let i = 0; i < N; i++) {
    const sock = io(API, { auth: { token: users[i].token }, transports: ['websocket'] });
    sock.on('state', (snap) => {
      latest[i] = snap;
    });
    sock.on('error', () => {
      /* отклонённое действие — пробуем дальше */
    });
    socks.push(sock);
    await new Promise((resolve, reject) => {
      sock.on('connect', resolve);
      sock.on('connect_error', reject);
    });
    log('  сокет ' + i + ' подключён');
  }

  log('Создание комнаты…');
  const created = await emitAck(socks[0], 'room:create');
  if (created.error) throw new Error('room:create: ' + created.error);
  const code = created.code;
  log('Код комнаты: ' + code);
  for (let i = 1; i < N; i++) {
    const j = await emitAck(socks[i], 'room:join', code);
    if (j.error) throw new Error('room:join ' + i + ': ' + j.error);
    log('  игрок ' + i + ' вошёл');
  }
  socks[0].emit('room:start');
  log('Команда старта отправлена');

  const deadline = Date.now() + 5 * 60 * 1000;
  let finished = null;
  let lastProgress = 0;

  const timer = setInterval(() => {
    const now = Date.now();
    for (let i = 0; i < N; i++) {
      const st = latest[i];
      const sock = socks[i];
      if (!st) continue;
      const me = st.players.find((p) => p.id === users[i].profile.id);
      if (!me) continue;
      if (st.phase === 'betting') {
        if (me.ante === 0) {
          sock.emit('game:ante', { amount: 20000 + rnd(0, 40000) });
        }
      } else if (st.phase === 'auction' && st.auction && st.auction.phase === 'bid') {
        if (!me.passed && !me.bidPlaced) {
          const roll = Math.random();
          const amount = roll < 0.12 ? 0 : rnd(1, Math.max(1, Math.floor(me.cash * 0.7)));
          sock.emit('game:bid', { amount });
        }
      } else if (st.phase === 'finished') {
        finished = st;
      }
    }
    if (now - lastProgress > 5000) {
      lastProgress = now;
      const phases = latest.map((st) => (st ? st.phase + (st.auction ? '/' + st.auction.phase + '/r' + st.auction.round : '') : 'нет'));
      log('прогресс: ' + phases.join(' | '));
    }
    if (finished || Date.now() > deadline) {
      clearInterval(timer);
      void finalize(finished);
    }
  }, 400);

  async function checkMarket() {
    log('Проверка барахолки…');
    const authH = (i) => ({ Authorization: 'Bearer ' + users[i].token, 'Content-Type': 'application/json' });
    const me = (i) => api('/api/me', { headers: authH(i) });

    // 1) продажа торговцу (игрок 1) — по номиналу предмета
    const b0 = await me(1);
    const vitem = b0.inventory[0];
    if (!vitem) throw new Error('у покупателя нет предмета');
    await api('/api/items/sell', { method: 'POST', headers: authH(1), body: JSON.stringify({ itemId: vitem.id }) });
    const b1 = await me(1);
    if (b1.cash !== b0.cash + vitem.value) throw new Error('торговец: наличные не совпали');
    log('  продажа торговцу OK: +' + vitem.value.toLocaleString('ru-RU'));

    // 2) листинг игроком 0
    const seller0 = await me(0);
    const itemForSale = seller0.inventory[0];
    if (!itemForSale) throw new Error('у продавца нет предмета');
    const price = 12345;
    await api('/api/market/list', {
      method: 'POST',
      headers: authH(0),
      body: JSON.stringify({ itemId: itemForSale.id, price }),
    });
    const market = await api('/api/market', { headers: authH(0) });
    const listing = market.find((l) => l.item.id === itemForSale.id);
    if (!listing) throw new Error('листинг не найден на барахолке');
    if (!listing.mine) throw new Error('листинг не помечен как мой');
    log('  листинг OK: ' + itemForSale.name + ' за ' + price.toLocaleString('ru-RU'));

    // 3) покупка игроком 1 (комиссия 5% в пользу дома)
    const aCashBefore = (await me(0)).cash;
    const bCashBefore = (await me(1)).cash;
    await api('/api/market/buy', { method: 'POST', headers: authH(1), body: JSON.stringify({ listingId: listing.id }) });
    const aCashAfter = (await me(0)).cash;
    const bCashAfter = (await me(1)).cash;
    const fee = Math.floor((price * 5) / 100);
    if (bCashAfter !== bCashBefore - price) throw new Error('покупка: наличные покупателя не совпали');
    if (aCashAfter !== aCashBefore + (price - fee)) throw new Error('покупка: наличные продавца не совпали');
    const buyerInv = (await me(1)).inventory;
    const sellerInv = (await me(0)).inventory;
    if (!buyerInv.some((i) => i.id === itemForSale.id)) throw new Error('покупка: предмет не у покупателя');
    if (sellerInv.some((i) => i.id === itemForSale.id)) throw new Error('покупка: предмет остался у продавца');
    log('  покупка OK: продавец +' + (price - fee).toLocaleString('ru-RU') + ', покупатель -' + price.toLocaleString('ru-RU') + ' (комиссия ' + fee + ')');

    // 4) отмена лота (игрок 2) — предмет возвращается
    const s2 = await me(2);
    const cItem = s2.inventory[0];
    if (!cItem) throw new Error('у игрока 2 нет предмета');
    await api('/api/market/list', {
      method: 'POST',
      headers: authH(2),
      body: JSON.stringify({ itemId: cItem.id, price: 5000 }),
    });
    const market2 = await api('/api/market', { headers: authH(2) });
    const myListing = market2.find((l) => l.item.id === cItem.id);
    if (!myListing) throw new Error('листинг 2 не найден');
    await api('/api/market/cancel', { method: 'POST', headers: authH(2), body: JSON.stringify({ listingId: myListing.id }) });
    const s2after = await me(2);
    if (!s2after.inventory.some((i) => i.id === cItem.id)) throw new Error('отмена: предмет не вернулся');
    log('  отмена лота OK: предмет вернулся в инвентарь');
    log('PASS: барахолка работает');
  }

  async function checkAdmin() {
    log('Проверка банка дома и админа…');

    // вход админа
    const adminLogin = await api('/api/auth/dev-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'smokeadmin@test.local', name: 'SmokeAdmin' }),
    });
    const adminH = { Authorization: 'Bearer ' + adminLogin.token, 'Content-Type': 'application/json' };
    const adminMe = await api('/api/me', { headers: adminH });
    if (!adminMe.isAdmin) throw new Error('админ не получил isAdmin');
    log('  админ распознан по email: ' + adminMe.email);

    // не-админ получает 403
    const denied = await fetch(API + '/api/admin/bank', { headers: { Authorization: 'Bearer ' + users[1].token } });
    if (denied.status !== 403) throw new Error('не-админ должен получать 403, получено ' + denied.status);
    log('  доступ для не-админа закрыт (403)');

    // банк дома: баланс и журнал (в журнале уже есть операции торговца)
    const bank0 = await api('/api/admin/bank', { headers: adminH });
    if (typeof bank0.balance !== 'number') throw new Error('нет баланса банка');
    // журнал операций отдаётся отдельной пагинированной ручкой
    const txPage0 = await api('/api/admin/bank/transactions?page=1&pageSize=200', { headers: adminH });
    const tx0 = txPage0.transactions;
    if (!Array.isArray(tx0)) throw new Error('журнал банка: нет массива transactions');
    if (!tx0.some((t) => t.type === 'vendor')) throw new Error('нет операции торговца в журнале');
    if (!tx0.some((t) => t.type === 'game')) throw new Error('нет операции дохода партии в журнале');
    if (typeof txPage0.total !== 'number' || txPage0.total < tx0.length) {
      throw new Error('журнал банка: некорректный total');
    }
    log('  банк дома: ' + bank0.balance.toLocaleString('ru-RU') + ', операций в журнале: ' + txPage0.total);

    // пополнение банка
    await api('/api/admin/bank/deposit', { method: 'POST', headers: adminH, body: JSON.stringify({ amount: 100000 }) });
    const bank1 = await api('/api/admin/bank', { headers: adminH });
    if (bank1.balance !== bank0.balance + 100000) throw new Error('пополнение: баланс не изменился');
    log('  пополнение банка OK: +100 000');

    // выплата игроку 0
    const u0 = await api('/api/me', { headers: { Authorization: 'Bearer ' + users[0].token } });
    await api('/api/admin/bank/transfer', { method: 'POST', headers: adminH, body: JSON.stringify({ email: u0.email, amount: 50000 }) });
    const u0after = await api('/api/me', { headers: { Authorization: 'Bearer ' + users[0].token } });
    if (u0after.cash !== u0.cash + 50000) throw new Error('выплата: наличные игрока не изменились');
    const bank2 = await api('/api/admin/bank', { headers: adminH });
    if (bank2.balance !== bank1.balance - 50000) throw new Error('выплата: баланс банка не изменился');
    log('  выплата игроку OK: 50 000 -> ' + u0.name);

    // дом выставляет выкупленный у торговца предмет
    const houseItem = bank2.inventory[0];
    if (!houseItem) throw new Error('у дома нет предметов');
    await api('/api/admin/market/list', { method: 'POST', headers: adminH, body: JSON.stringify({ itemId: houseItem.id, price: 9999 }) });
    const market = await api('/api/market', { headers: { Authorization: 'Bearer ' + users[2].token } });
    const hLot = market.find((l) => l.item.id === houseItem.id);
    if (!hLot) throw new Error('лот дома не найден на барахолке');
    if (hLot.sellerName !== 'Дом') throw new Error('продавец лота не Дом: ' + hLot.sellerName);
    const u3 = await api('/api/me', { headers: { Authorization: 'Bearer ' + users[3].token } });
    await api('/api/market/buy', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + users[3].token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ listingId: hLot.id }),
    });
    const u3after = await api('/api/me', { headers: { Authorization: 'Bearer ' + users[3].token } });
    if (u3after.cash !== u3.cash - 9999) throw new Error('покупка у дома: наличные не совпали');
    log('  продажа предмета дома OK: ' + houseItem.name + ' за 9 999');
    log('PASS: банк дома и админ работают');
  }

  async function checkHideout() {
    log('Проверка убежища и сетов…');
    const u0 = users[0];
    const u0H = { Authorization: 'Bearer ' + u0.token, 'Content-Type': 'application/json' };
    const adminLogin = await api('/api/auth/dev-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'smokeadmin@test.local', name: 'SmokeAdmin' }),
    });
    const adminH = { Authorization: 'Bearer ' + adminLogin.token, 'Content-Type': 'application/json' };
    const grant = (defId) =>
      api('/api/admin/items/grant', { method: 'POST', headers: adminH, body: JSON.stringify({ email: u0.email, defId }) });

    // сет «Тёплый очаг»
    const tavernDefs = ['white-2', 'white-7', 'white-3', 'green-5', 'white-8'];
    const placedIds = [];
    for (const defId of tavernDefs) {
      await grant(defId);
      const me = await api('/api/me', { headers: u0H });
      const it = me.inventory.find((i) => i.defId === defId);
      if (!it) throw new Error('выданный предмет ' + defId + ' не найден в инвентаре');
      placedIds.push(it.id);
      await api('/api/hideout/place', { method: 'POST', headers: u0H, body: JSON.stringify({ setId: 'tavern', itemId: it.id }) });
    }
    let h = await api('/api/hideout', { headers: u0H });
    const tavern = h.sets.find((s) => s.setId === 'tavern');
    if (!tavern || !tavern.active) throw new Error('сет трактирщика не активен');
    if (!h.activeBonusIds.includes('trader_bonus')) throw new Error('trader_bonus не активен');
    // выставленные предметы исключены из инвентаря
    const meCheck = await api('/api/me', { headers: u0H });
    if (placedIds.some((id) => meCheck.inventory.some((i) => i.id === id))) {
      throw new Error('предметы витрины видны в инвентаре');
    }
    log('  сет «Тёплый очаг» активен (5/5), предметы заперты в витрине');

    // продажа торговцу с бонусом +5%
    const me0 = await api('/api/me', { headers: u0H });
    const itemToSell = me0.inventory.find((i) => i.rarity === 'white') ?? me0.inventory[0];
    if (!itemToSell) throw new Error('нет предмета для продажи');
    const cashBefore = me0.cash;
    const sellRes = await api('/api/items/sell', { method: 'POST', headers: u0H, body: JSON.stringify({ itemId: itemToSell.id }) });
    const expected = Math.round(itemToSell.value * 1.05);
    if (sellRes.value !== expected) throw new Error('продажа с бонусом: ' + sellRes.value + ' вместо ' + expected);
    const me1 = await api('/api/me', { headers: u0H });
    if (me1.cash !== cashBefore + expected) throw new Error('наличные с бонусом не совпали');
    log('  продажа торговцу с +5%: ' + expected.toLocaleString('ru-RU'));

    // сняли предмет — сет неактивен — бонус выключен
    await api('/api/hideout/remove', { method: 'POST', headers: u0H, body: JSON.stringify({ itemId: placedIds[0] }) });
    h = await api('/api/hideout', { headers: u0H });
    if (h.sets.find((s) => s.setId === 'tavern')?.active) throw new Error('сет всё ещё активен после снятия');
    const me2 = await api('/api/me', { headers: u0H });
    const itemToSell2 = me2.inventory.find((i) => i.rarity === 'white');
    if (!itemToSell2) throw new Error('нет второго белого предмета');
    const cashBefore2 = me2.cash;
    const sellRes2 = await api('/api/items/sell', { method: 'POST', headers: u0H, body: JSON.stringify({ itemId: itemToSell2.id }) });
    if (sellRes2.value !== itemToSell2.value) throw new Error('продажа без бонуса не по номиналу');
    const me3 = await api('/api/me', { headers: u0H });
    if (me3.cash !== cashBefore2 + itemToSell2.value) throw new Error('наличные без бонуса не совпали');
    log('  после снятия предмета бонус отключён: продажа по номиналу');

    // сет алхимика + трансмутация
    const alchDefs = ['white-0', 'white-1', 'white-5', 'green-1', 'red-7'];
    for (const defId of alchDefs) {
      await grant(defId);
      const me = await api('/api/me', { headers: u0H });
      const it = me.inventory.find((i) => i.defId === defId);
      if (!it) throw new Error('предмет алхимика ' + defId + ' не найден');
      await api('/api/hideout/place', { method: 'POST', headers: u0H, body: JSON.stringify({ setId: 'alchemist', itemId: it.id }) });
    }
    // гарантируем 3 свободных белых предмета
    for (const defId of ['white-0', 'white-1', 'white-5']) await grant(defId);
    h = await api('/api/hideout', { headers: u0H });
    if (!h.sets.find((s) => s.setId === 'alchemist')?.active) throw new Error('сет алхимика не активен');
    const beforeInv = (await api('/api/me', { headers: u0H })).inventory;
    const beforeIds = new Set(beforeInv.map((i) => i.id));
    const tr = await api('/api/hideout/transmute', { method: 'POST', headers: u0H });
    if (!tr.ok) throw new Error('трансмутация: ' + tr.error);
    const afterInv = (await api('/api/me', { headers: u0H })).inventory;
    if (afterInv.length !== beforeInv.length - 2) {
      throw new Error('трансмутация: инвентарь изменился неверно (' + beforeInv.length + ' -> ' + afterInv.length + ')');
    }
    const newItem = afterInv.find((i) => !beforeIds.has(i.id));
    if (!newItem || (newItem.rarity !== 'green' && newItem.rarity !== 'blue')) {
      throw new Error('трансмутация: нет нового зелёного/синего предмета');
    }
    const tr2 = await fetch(API + '/api/hideout/transmute', { method: 'POST', headers: u0H });
    if (tr2.status !== 400) throw new Error('повторная трансмутация должна дать 400, получено ' + tr2.status);
    log('  трансмутация OK: 3 белых -> ' + newItem.rarity + ' «' + newItem.name + '», кулдаун работает');
    // сетка инвентаря: позиции сохраняются, пересечения запрещены, автосортировка
    let meInv = (await api('/api/me', { headers: u0H })).inventory;
    if (!meInv.every((i) => i.invX !== undefined && i.invY !== undefined)) {
      throw new Error('не у всех предметов есть позиция в сетке');
    }
    const itemA = meInv[0];
    // ищем свободную клетку для перемещения
    const occ = new Set();
    for (const it of meInv) {
      if (it.invX === undefined) continue;
      for (let dy = 0; dy < it.h; dy++) {
        for (let dx = 0; dx < it.w; dx++) occ.add(it.invX + dx + ',' + (it.invY + dy));
      }
    }
    let freeCell = null;
    outer: for (let y = 0; y < 24; y++) {
      for (let x = 0; x < 12; x++) {
        let fits = true;
        for (let dy = 0; dy < itemA.h; dy++) {
          for (let dx = 0; dx < itemA.w; dx++) {
            if (x + dx >= 12 || occ.has(x + dx + ',' + (y + dy))) { fits = false; break; }
          }
          if (!fits) break;
        }
        if (fits) { freeCell = { x, y }; break outer; }
      }
    }
    if (!freeCell) throw new Error('нет свободной клетки для перемещения');
    await api('/api/items/move', { method: 'POST', headers: u0H, body: JSON.stringify({ itemId: itemA.id, x: freeCell.x, y: freeCell.y }) });
    const meInv2 = (await api('/api/me', { headers: u0H })).inventory;
    const moved = meInv2.find((i) => i.id === itemA.id);
    if (!moved || moved.invX !== freeCell.x || moved.invY !== freeCell.y) throw new Error('позиция предмета не сохранилась');
    const itemB = meInv2.find((i) => i.id !== itemA.id);
    if (itemB) {
      const conflict = await fetch(API + '/api/items/move', {
        method: 'POST',
        headers: u0H,
        body: JSON.stringify({ itemId: itemB.id, x: freeCell.x, y: freeCell.y }),
      });
      if (conflict.status !== 400) throw new Error('пересечение должно дать 400, получено ' + conflict.status);
    }
    await api('/api/items/sort', { method: 'POST', headers: u0H });
    const meInv3 = (await api('/api/me', { headers: u0H })).inventory;
    for (let i = 0; i < meInv3.length; i++) {
      for (let j = i + 1; j < meInv3.length; j++) {
        const a = meInv3[i];
        const b = meInv3[j];
        if (a.invX === undefined || b.invX === undefined) continue;
        if (a.invX < b.invX + b.w && a.invX + a.w > b.invX && a.invY < b.invY + b.h && a.invY + a.h > b.invY) {
          throw new Error('после сортировки есть пересечение');
        }
      }
    }
    // границы фиксированной сетки 12x24
    for (const it of meInv3) {
      if (it.invX === undefined) continue;
      if (it.invX + it.w > 12 || it.invY + it.h > 24) {
        throw new Error('предмет вне сетки 12x24: ' + it.name + ' на ' + it.invX + ',' + it.invY);
      }
    }
    const outX = await fetch(API + '/api/items/move', {
      method: 'POST',
      headers: u0H,
      body: JSON.stringify({ itemId: itemA.id, x: 12, y: 0 }),
    });
    if (outX.status !== 400) throw new Error('x за границей должен дать 400, получено ' + outX.status);
    const outY = await fetch(API + '/api/items/move', {
      method: 'POST',
      headers: u0H,
      body: JSON.stringify({ itemId: itemA.id, x: 0, y: 24 }),
    });
    if (outY.status !== 400) throw new Error('y за границей должен дать 400, получено ' + outY.status);
    log('  сетка 12x24: позиции сохраняются, пересечения запрещены, выход за границы блокируется');
    log('PASS: убежище и сеты работают');
  }

  async function checkHistory(st) {
    log('Проверка истории матчей…');
    for (let i = 0; i < N; i++) {
      const u = users[i];
      const h = await api('/api/profile/' + u.profile.id + '/history', {
        headers: { Authorization: 'Bearer ' + u.token },
      });
      if (!Array.isArray(h) || h.length < 1) throw new Error('история пуста у ' + u.profile.name);
      const row = h[0]; // последняя партия — первая в списке
      if (row.code !== st.code) throw new Error('код комнаты в истории не совпал у ' + u.profile.name);
      if (row.players !== N) throw new Error('число игроков в истории не совпало у ' + u.profile.name);
      if (row.winnerId !== st.final.winnerId) throw new Error('победитель в истории не совпал у ' + u.profile.name);
      const myStanding = st.final.standings.find((s) => s.playerId === u.profile.id);
      if (!myStanding || row.place !== myStanding.place) throw new Error('место в истории не совпало у ' + u.profile.name);
      // разница: итог − стартовые наличные − стартовый номинал инвентаря (профиль до партии)
      const me = st.players.find((p) => p.id === u.profile.id);
      const startInv = u.profile.inventory.reduce((s, it) => s + it.value, 0);
      const expectedProfit = myStanding.total - me.startCash - startInv;
      if (row.profit !== expectedProfit) {
        throw new Error('разница в истории не совпала у ' + u.profile.name + ': ' + row.profit + ' вместо ' + expectedProfit);
      }
      if (!Number.isInteger(row.invested) || row.invested < 0) {
        throw new Error('вложения некорректны у ' + u.profile.name + ': ' + row.invested);
      }
    }
    log('  история у всех ' + N + ' игроков: вложения и разница записаны верно');

    // детализация матча: предметы призового стола (модалка истории)
    const firstRow = (await api('/api/profile/' + users[0].profile.id + '/history', {
      headers: { Authorization: 'Bearer ' + users[0].token },
    }))[0];
    const detail = await api('/api/game/' + firstRow.gameId, {
      headers: { Authorization: 'Bearer ' + users[0].token },
    });
    if (detail.winnerId !== st.final.winnerId) throw new Error('победитель в детализации не совпал');
    if (detail.players.length !== N) throw new Error('участников в детализации: ' + detail.players.length);
    if (!Array.isArray(detail.items) || detail.items.length === 0) throw new Error('в детализации матча нет предметов стола');
    for (const it of detail.items) {
      if (typeof it.name !== 'string' || typeof it.value !== 'number' || typeof it.rarity !== 'string') {
        throw new Error('предмет стола в детализации некорректен: ' + JSON.stringify(it));
      }
    }
    const owners = new Set(detail.items.map((i) => i.ownerId).filter((o) => o));
    if (owners.size > 1) throw new Error('владельцев предметов больше одного: ' + [...owners].join(','));
    log('  детализация матча: ' + detail.items.length + ' предметов стола, владельцы согласованы');
    log('PASS: история матчей работает');
  }

  async function finalize(st) {
    if (!st) {
      log('FAIL: таймаут — игра не завершилась за 5 минут');
      process.exit(1);
    }
    const winnerName = st.players.find((p) => p.id === st.final.winnerId)?.name;
    log('Игра завершена! Победитель: ' + winnerName);
    for (const s of st.final.standings) {
      const name = st.players.find((p) => p.id === s.playerId)?.name;
      log('  ' + s.place + '. ' + name + ' — наличные ' + s.cash.toLocaleString('ru-RU') + ', инвентарь ' + s.inventoryValue.toLocaleString('ru-RU') + ', итог ' + s.total.toLocaleString('ru-RU'));
    }
    await new Promise((r) => setTimeout(r, 800));
    let ok = true;
    for (let i = 0; i < N; i++) {
      const me = await api('/api/me', { headers: { Authorization: 'Bearer ' + users[i].token } });
      const stRow = st.final.standings.find((s) => s.playerId === me.id);
      if (!stRow) {
        log('FAIL: нет места у ' + me.name);
        ok = false;
        continue;
      }
      if (me.cash !== stRow.cash) {
        log('FAIL: cash не совпал у ' + me.name + ' (' + me.cash + ' vs ' + stRow.cash + ')');
        ok = false;
      }
      if (me.gamesPlayed < 1) {
        log('FAIL: gamesPlayed не увеличилось у ' + me.name);
        ok = false;
      }
    }
    try {
      await checkHistory(st);
    } catch (e) {
      log('FAIL (история матчей): ' + e.message);
      ok = false;
    }
    try {
      await checkMarket();
    } catch (e) {
      log('FAIL (барахолка): ' + e.message);
      ok = false;
    }
    try {
      await checkAdmin();
    } catch (e) {
      log('FAIL (банк/админ): ' + e.message);
      ok = false;
    }
    try {
      await checkHideout();
    } catch (e) {
      log('FAIL (убежище): ' + e.message);
      ok = false;
    }
    for (const s of socks) s.disconnect();
    if (ok) {
      log('PASS: полный игровой цикл, барахолка, банк дома и убежище работают');
      process.exit(0);
    }
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('[smoke] FAIL:', e && e.stack ? e.stack : e);
  process.exit(1);
});
