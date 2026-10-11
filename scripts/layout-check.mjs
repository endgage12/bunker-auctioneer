#!/usr/bin/env node
// Проверка вёрстки на трёх целевых ширинах через headless Chrome (DevTools Protocol).
//
// Зачем: классы Tailwind видно в исходнике, но фактическую ширину контейнеров,
// горизонтальное переполнение и срабатывание брейкпоинтов показывает только
// браузер. Скрипт открывает страницы на 360 / 1200 / 1920 px и измеряет их.
//
// Запуск: node scripts/layout-check.mjs [webUrl] [apiUrl]

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const URL_BASE = process.argv[2] ?? 'http://localhost:5173';
const API_BASE = process.argv[3] ?? 'http://localhost:3000';

const PAGES = ['/', '/market', '/shop', '/inventory', '/sets', '/library', '/leaderboard', '/santa'];
const WIDTHS = [360, 1200, 1920];
const PORT = 9333 + Math.floor(Math.random() * 200);

/**
 * Замер страницы. Выполняется в браузере, поэтому это обычная функция без
 * внешних зависимостей: она сериализуется в выражение и вызывается там.
 */
function measure() {
  const de = document.documentElement;
  const page = document.querySelector('.page, .page-wide, .page-narrow');

  // самый широкий элемент, выходящий за правый край окна
  let worst = null;
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0) continue;
    const over = Math.round(r.right - de.clientWidth);
    if (over > 2 && (!worst || over > worst.over)) {
      const chain = [];
      let a = el;
      for (let k = 0; k < 3 && a; k++) {
        chain.push(String(a.className || a.tagName).split(' ')[0]);
        a = a.parentElement;
      }
      worst = {
        over,
        tag: el.tagName.toLowerCase(),
        cls: String(el.className).slice(0, 50),
        width: Math.round(r.width),
        left: Math.round(r.left),
        chain: chain.join(' < '),
      };
    }
  }

  // сколько колонок в первой многоколоночной сетке — видно, сработал ли брейкпоинт
  let cols = null;
  for (const el of document.querySelectorAll('body *')) {
    const c = getComputedStyle(el).gridTemplateColumns;
    if (c && c !== 'none' && c.split(' ').length > 1) {
      cols = c.split(' ').length;
      break;
    }
  }

  const cs = page ? getComputedStyle(page) : null;
  const invCell = document.querySelector('.inv-cell');

  return {
    route: location.hash,
    h1: (document.querySelector('#app h1')?.textContent ?? '(нет h1)').trim().slice(0, 32),
    // сколько страниц отрисовано одновременно: признак незавершённого перехода
    // маркеры конкретных страниц: надёжнее, чем h1
    marks: [
      document.querySelector('.leader-row') ? 'leader-rows' : null,
      document.querySelector('.inv-cell') ? 'inv-cells' : null,
      document.querySelector('.tier-card') ? 'tier-cards' : null,
      document.querySelector('.wheel-stage') ? 'wheel' : null,
    ].filter(Boolean).join(','),
    viewport: de.clientWidth,
    containerWidth: page ? Math.round(page.getBoundingClientRect().width) : null,
    maxWidth: cs ? cs.maxWidth : null,
    // фактическая горизонтальная прокрутка: единственный надёжный признак
    // переполнения. Отдельные элементы могут выходить за край, но быть
    // обрезанными родителем (декоративные свечения) — это не переполнение.
    overflowX: Math.max(de.scrollWidth - de.clientWidth, document.body.scrollWidth - document.body.clientWidth),
    gridCols: cols,
    invCell: invCell ? Math.round(invCell.getBoundingClientRect().width) : null,
    worst,
    clipped: (() => {
      // сколько элементов выходят за край, но обрезаны родителем
      let n = 0;
      for (const el of document.querySelectorAll('body *')) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.right - de.clientWidth <= 2) continue;
        n += 1;
      }
      return n;
    })(),
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = mkdtempSync(join(tmpdir(), 'layout-check-'));

const chrome = spawn(
  'google-chrome',
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--hide-scrollbars',
    'about:blank',
  ],
  { stdio: 'ignore' },
);

/** Ждём, пока DevTools отдаст вкладку */
async function targetWs() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {
      /* ещё не поднялся */
    }
    await sleep(250);
  }
  throw new Error('Chrome не поднялся');
}

/** Минимальный клиент CDP */
async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', () => res());
    ws.addEventListener('error', (e) => rej(e));
  });
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const mid = ++id;
      pending.set(mid, { resolve, reject });
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
  return { ws, send };
}

/** Токен: приложение закрыто авторизацией, без него любой маршрут ведёт на вход */
async function devToken() {
  const res = await fetch(API_BASE + '/api/auth/dev-login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'layout-check@local.test', name: 'Вёрстка' }),
  });
  const data = await res.json();
  return data.token;
}

const lines = [];
let failures = 0;

try {
  const { ws, send } = await connect(await targetWs());
  await send('Page.enable');
  await send('Runtime.enable');

  // Грузим приложение, кладём токен в localStorage, затем перечитываем
  // страницу: только после этого защита пропустит на игровые маршруты.
  await send('Page.navigate', { url: URL_BASE + '/#/login' });
  await sleep(1600);
  const token = await devToken();
  const saved = await send('Runtime.evaluate', {
    expression: `(() => { localStorage.setItem('auctioneer_token', ${JSON.stringify(token)}); return localStorage.getItem('auctioneer_token') ? 'ok' : 'пусто'; })()`,
    returnByValue: true,
  });
  lines.push('токен доступа: ' + saved.result.value);
  await send('Page.reload', { ignoreCache: false });
  await sleep(1600);

  for (const path of PAGES) {
    lines.push('\n' + path);
    for (const width of WIDTHS) {
      await send('Emulation.setDeviceMetricsOverride', {
        width,
        height: 1000,
        deviceScaleFactor: 1,
        mobile: width <= 420,
      });
      // Полная навигация по URL с hash: смена hash не дожидалась загрузки
      // асинхронного компонента маршрута, и на замере оставалась прошлая
      // страница. Токен уже в localStorage того же origin, поэтому вход сохранён.
      await send('Page.navigate', { url: URL_BASE + '/#' + path });
      // страницы грузят данные асинхронно: без паузы замер попадает на «Загрузка…»
      await sleep(2600);

      const { result } = await send('Runtime.evaluate', {
        expression: `(${measure.toString()})()`,
        returnByValue: true,
      });
      const m = result.value;
      const bad = m.overflowX > 1;
      if (bad) failures += 1;

      lines.push(
        `  ${bad ? '❌' : '  '} ${String(width).padStart(4)}px → контейнер ` +
          `${String(m.containerWidth).padStart(4)}px (предел ${m.maxWidth}), колонок ${m.gridCols ?? 1}` +
          `, прокрутка X: ${m.overflowX}` +
          (m.invCell ? `, ячейка инвентаря ${m.invCell}px` : '') +
          (m.clipped ? `, обрезано декоративных: ${m.clipped}` : '') +
          ` | ${m.route} [${m.marks}]` +
          (bad && m.worst ? `\n        прокрутку создаёт <${m.worst.tag}> +${m.worst.over}px (${m.worst.chain})` : ''),
      );
    }
  }
  ws.close();
} finally {
  chrome.kill();
  await sleep(400);
  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    /* временная папка останется — на результат не влияет */
  }
}

console.log(lines.join('\n'));
console.log(
  failures === 0
    ? '\n✓ горизонтального переполнения нет на 360 / 1200 / 1920px'
    : `\n❌ страниц с переполнением: ${failures}`,
);
process.exit(failures === 0 ? 0 : 1);
