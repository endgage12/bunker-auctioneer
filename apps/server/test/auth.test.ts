// Юнит-тесты входа по паролю: постоянное сравнение и throttle неудачных попыток.
import { describe, expect, it } from 'vitest';
import { registerFailedLogin, resetLoginAttempts, safeEqual } from '../src/auth';

describe('safeEqual: сравнение пароля за постоянное время', () => {
  it('совпадение и несовпадение', () => {
    expect(safeEqual('zasq12', 'zasq12')).toBe(true);
    expect(safeEqual('zasq12', 'zasq13')).toBe(false);
    expect(safeEqual('', '')).toBe(true);
    expect(safeEqual('', 'a')).toBe(false);
  });

  it('разная длина не считается равной', () => {
    expect(safeEqual('zasq1', 'zasq12')).toBe(false);
    expect(safeEqual('zasq12', 'zasq12 ')).toBe(false);
    expect(safeEqual('a', 'ab')).toBe(false);
  });

  it('совпадение префикса не проходит', () => {
    // тот же префикс, отличается последний символ — самый «опасный» для наивного сравнения случай
    expect(safeEqual('zasq12xxxxxxxx', 'zasq12yyyyyyyy')).toBe(false);
    expect(safeEqual('password', 'passworX')).toBe(false);
  });

  it('корректно работает с юникодом', () => {
    expect(safeEqual('пароль', 'пароль')).toBe(true);
    expect(safeEqual('пароль', 'паролъ')).toBe(false);
  });
});

describe('throttle неудачных попыток входа', () => {
  it('задержка растёт экспоненциально и ограничена сверху', () => {
    const key = 'test-throttle-' + Math.random();
    const now = 1_000_000;
    const d1 = registerFailedLogin(key, now);
    const d2 = registerFailedLogin(key, now);
    const d3 = registerFailedLogin(key, now);
    expect(d1).toBeGreaterThan(0);
    expect(d2).toBeGreaterThan(d1);
    expect(d3).toBeGreaterThan(d2);
    // верхняя граница — 5 минут
    let last = 0;
    for (let i = 0; i < 20; i++) last = registerFailedLogin(key, now);
    expect(last).toBe(5 * 60_000);
    resetLoginAttempts(key);
  });

  it('после сброса счётчик начинается заново', () => {
    const key = 'test-reset-' + Math.random();
    const now = 2_000_000;
    for (let i = 0; i < 5; i++) registerFailedLogin(key, now);
    resetLoginAttempts(key);
    const afterReset = registerFailedLogin(key, now);
    const fresh = registerFailedLogin('test-fresh-' + Math.random(), now);
    // после сброса первая неудача даёт такую же паузу, как у «чистого» ключа
    expect(afterReset).toBe(fresh);
    resetLoginAttempts(key);
  });

  it('давние неудачи не накапливаются', () => {
    const key = 'test-stale-' + Math.random();
    const now = 3_000_000;
    for (let i = 0; i < 10; i++) registerFailedLogin(key, now);
    // спустя окно сброса счётчик обнуляется
    const later = now + 11 * 60_000;
    const d = registerFailedLogin(key, later);
    expect(d).toBe(registerFailedLogin('test-fresh2-' + Math.random(), later));
    resetLoginAttempts(key);
  });
});
