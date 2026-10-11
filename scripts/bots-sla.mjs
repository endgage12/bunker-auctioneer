// E2E-проверка задачи «боты»: живой игрок нажимает «Играть» и должен начать
// партию не позже 30 секунд, а свободные места в лобби должны быть всегда.
import { io } from 'socket.io-client';

const API = process.env.API_URL ?? 'http://localhost:3000';
const RUNS = Number(process.env.RUNS ?? 5);
const SLA_MS = 30_000;

async function devLogin(email, name) {
  const r = await fetch(API + '/api/auth/dev-login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, name }),
  });
  if (!r.ok) throw new Error('dev-login ' + r.status);
  return r.json();
}

function connect(token) {
  return new Promise((resolve, reject) => {
    const s = io(API, { auth: { token }, transports: ['websocket'] });
    s.on('connect', () => resolve(s));
    s.on('connect_error', reject);
  });
}

/** Один заход: нажать «Играть» и дождаться старта партии (фаза != waiting) */
async function measureOnce(i) {
  const { token, profile } = await devLogin('sla-human-' + i + '-' + Date.now() + '@test.local', 'Живой ' + i);
  const socket = await connect(token);

  let startedAt = 0;
  let ok = false;
  let bots = 0;
  const trace = [];

  // следим, что происходит с комнатами, пока игрок ждёт
  const watcher = setInterval(() => {
    fetch(API + '/api/bots/stats', { headers: { Authorization: 'Bearer ' + token } })
      .then((r) => r.json())
      .then((s) => {
        trace.push(
          Math.round((Date.now() - startedAt) / 100) / 10 +
            'с: свободных ботов ' + s.available + ', комнат ' + s.gamesInProgress +
            ', мест ' + s.freeSeats + ', ждут людей ' + (s.matchmaking?.humanMatchRequests ?? 0),
        );
      })
      .catch(() => undefined);
  }, 1500);

  const done = new Promise((resolve) => {
    socket.on('state', (state) => {
      if (state.phase === 'waiting') return;
      const others = state.players.filter((p) => p.id !== profile.id).length;
      bots = others;
      ok = true;
      resolve();
    });
    setTimeout(resolve, SLA_MS + 30_000);
  });

  startedAt = Date.now();
  await new Promise((resolve) => socket.emit('room:play', {}, resolve));
  await done;
  clearInterval(watcher);
  const waited = Date.now() - startedAt;
  socket.close();
  return { waited, ok, bots, name: profile.name, trace };
}

const results = [];
for (let i = 1; i <= RUNS; i++) {
  const r = await measureOnce(i);
  results.push(r);
  console.log(
    '[sla] заход ' + i + ': ' + (r.ok ? 'партия началась' : 'НЕ началась') +
      ' через ' + (r.waited / 1000).toFixed(1) + 'с, соперников-ботов: ' + r.bots,
  );
}

const waits = results.filter((r) => r.ok).map((r) => r.waited).sort((a, b) => a - b);
const started = results.filter((r) => r.ok).length;
const median = waits.length ? waits[Math.floor((waits.length - 1) / 2)] : 0;
const worst = waits.length ? waits[waits.length - 1] : 0;
console.log('');
console.log('[sla] партий начато: ' + started + ' из ' + RUNS);
console.log('[sla] медиана ожидания: ' + (median / 1000).toFixed(1) + 'с');
console.log('[sla] максимум: ' + (worst / 1000).toFixed(1) + 'с');
console.log('[sla] ' + (started === RUNS && worst <= SLA_MS ? 'PASS' : 'FAIL') + ': ожидание ≤ 30 секунд');
process.exit(started === RUNS && worst <= SLA_MS ? 0 : 1);
