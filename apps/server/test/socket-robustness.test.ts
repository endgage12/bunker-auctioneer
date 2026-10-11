// Регрессия: событие сокета без ack-колбэка не должно ронять сервер.
//
// Раньше обработчики делали `ack?.(...)`, где в параметр ack попадал payload
// (если клиент не передал колбэк) — вызов падал с «ack is not a function»,
// и любой авторизованный клиент мог уронить процесс одной строкой.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SOCKET_SRC = join(__dirname, '..', 'src', 'socket.ts');

describe('устойчивость сокет-обработчиков', () => {
  const src = readFileSync(SOCKET_SRC, 'utf8');

  it('нет прямых вызовов ack?.() — только проверенная обёртка', () => {
    // комментарии не считаем
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
    expect(code.includes('ack?.(')).toBe(false);
  });

  it('ack берётся через ackOf, который ищет функцию среди аргументов', () => {
    expect(src).toContain('function ackOf<T>(...args: unknown[])');
    // колбэк лежит последним аргументом, поэтому поиск идёт с конца
    expect(src).toMatch(/for \(let i = args\.length - 1; i >= 0; i--\)/);
    expect(src).toContain("typeof args[i] === 'function'");
  });

  it('ackOf вызывается со всем списком аргументов (payload + колбэк)', () => {
    const calls = [...src.matchAll(/const ack = ackOf<.*?>\((.*?)\);/g)];
    expect(calls.length).toBeGreaterThanOrEqual(5);
    for (const m of calls) {
      expect(m[1], 'ackOf должен получать все аргументы обработчика').toBe('...args');
    }
  });

  it('все обработчики событий обёрнуты в guard', () => {
    const handlers = [...src.matchAll(/socket\.on\(C2S\.(\w+),/g)].map((m) => m[1]);
    expect(handlers.length).toBeGreaterThanOrEqual(10);
    for (const m of src.matchAll(/socket\.on\((C2S\.\w+), (\w+)/g)) {
      expect(m[2], 'обработчик ' + m[1] + ' должен быть обёрнут в guard').toBe('guard');
    }
  });

  it('guard ловит исключения и логирует их', () => {
    expect(src).toContain('function guard(');
    expect(src).toContain('catch (err)');
    expect(src).toContain('console.error');
  });
});
