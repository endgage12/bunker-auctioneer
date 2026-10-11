// Общий модуль анимаций: единственная точка настройки GSAP и переиспользуемые
// хелперы, чтобы одинаковые движения по всему интерфейсу не дублировались.
import { gsap } from 'gsap';
import { Flip } from 'gsap/Flip';

gsap.registerPlugin(Flip);

/**
 * Уважение к системной настройке «уменьшить движение». Все компоненты
 * спрашивают этот флаг, прежде чем запускать что-то заметное.
 */
export const motionOK =
  typeof window === 'undefined' ? true : window.matchMedia('(prefers-reduced-motion: no-preference)').matches;

/** Длительности в одном месте, чтобы интерфейс ощущался единообразно */
export const DUR = {
  fast: 0.18,
  base: 0.32,
  slow: 0.6,
  entrance: 0.45,
} as const;

/**
 * Контекст анимаций для компонента Vue.
 * Возвращает gsap.Context: обязательно `ctx.revert()` в onBeforeUnmount,
 * иначе твины и inline-стили останутся после размонтирования.
 */
export function animContext(scope: Element | null | undefined, setup: () => void): gsap.Context {
  const ctx = gsap.context(setup, scope ?? undefined);
  if (!motionOK) ctx.progress(1);
  return ctx;
}

/** Мягкое появление элемента снизу */
export function popIn(el: Element | null, opts: { delay?: number; y?: number } = {}): void {
  if (!el || !motionOK) return;
  gsap.from(el, {
    y: opts.y ?? 12,
    opacity: 0,
    duration: DUR.entrance,
    delay: opts.delay ?? 0,
    ease: 'power2.out',
    overwrite: 'auto',
  });
}

/** Каскадное появление списка (строки, карточки, клетки) */
export function staggerIn(
  els: Element[] | NodeListOf<Element> | null,
  opts: { stagger?: number; y?: number; scale?: number; delay?: number; duration?: number } = {},
): void {
  const list = els ? Array.from(els as ArrayLike<Element>) : [];
  if (list.length === 0 || !motionOK) return;
  gsap.from(list, {
    y: opts.y ?? 10,
    opacity: 0,
    scale: opts.scale ?? 1,
    duration: opts.duration ?? DUR.base,
    delay: opts.delay ?? 0,
    // на больших списках каскад делаем мелким, чтобы не тянуть анимацию
    stagger: opts.stagger ?? Math.min(0.03, 1.2 / list.length),
    ease: 'power2.out',
    overwrite: 'auto',
  });
}

/** Короткая вспышка — «прилетело», «начислили», «сработало» */
export function flash(el: Element | null, color = 'rgba(251,191,36,0.85)'): void {
  if (!el || !motionOK) return;
  gsap.fromTo(
    el,
    { filter: `drop-shadow(0 0 0 ${color})` },
    { filter: `drop-shadow(0 0 14px ${color})`, duration: 0.22, yoyo: true, repeat: 1, ease: 'power2.out' },
  );
}

/** Тряска — отказ, ошибка, «нельзя» */
export function shake(el: Element | null): void {
  if (!el || !motionOK) return;
  gsap.fromTo(el, { x: -5 }, { x: 0, duration: 0.45, ease: 'elastic.out(1, 0.3)', overwrite: 'auto' });
}

/** Пульс — привлечь внимание к важному (таймер, счётчик, раунд) */
export function pulse(el: Element | null, scale = 1.08): void {
  if (!el || !motionOK) return;
  gsap.fromTo(
    el,
    { scale: 1 },
    { scale, duration: 0.22, yoyo: true, repeat: 1, ease: 'power2.inOut', overwrite: 'auto' },
  );
}

/**
 * Плавный счётчик чисел: значение «набегает» вместо мгновенной подмены.
 * fmt по умолчанию — разделители разрядов.
 */
export function countUp(
  el: Element | null,
  from: number,
  to: number,
  fmt: (v: number) => string = (v) => Math.round(v).toLocaleString('ru-RU'),
): void {
  if (!el) return;
  if (!motionOK || from === to) {
    el.textContent = fmt(to);
    return;
  }
  const state = { v: from };
  gsap.to(state, {
    v: to,
    duration: Math.min(1.1, 0.3 + Math.abs(to - from) / 400_000),
    ease: 'power2.out',
    overwrite: 'auto',
    onUpdate: () => {
      el.textContent = fmt(state.v);
    },
    onComplete: () => {
      el.textContent = fmt(to);
    },
  });
}

/** Полёт элемента к цели — монеты, предметы, карточки */
export function flyTo(from: Element | null, to: Element | null, opts: { duration?: number } = {}): void {
  if (!from || !to || !motionOK) return;
  const a = from.getBoundingClientRect();
  const b = to.getBoundingClientRect();
  const ghost = from.cloneNode(true) as HTMLElement;
  ghost.style.position = 'fixed';
  ghost.style.left = a.left + 'px';
  ghost.style.top = a.top + 'px';
  ghost.style.width = a.width + 'px';
  ghost.style.height = a.height + 'px';
  ghost.style.pointerEvents = 'none';
  ghost.style.zIndex = '60';
  document.body.appendChild(ghost);
  gsap.to(ghost, {
    x: b.left + b.width / 2 - (a.left + a.width / 2),
    y: b.top + b.height / 2 - (a.top + a.height / 2),
    scale: 0.35,
    opacity: 0.2,
    duration: opts.duration ?? 0.55,
    ease: 'power2.in',
    onComplete: () => ghost.remove(),
  });
}

/** FLIP-переход: снять состояние, изменить DOM, проиграть перелёт */
export function flipTransition(els: Element[] | null, mutate: () => void, duration = DUR.base): void {
  const list = els ? Array.from(els) : [];
  if (list.length === 0 || !motionOK) {
    mutate();
    return;
  }
  const state = Flip.getState(list);
  mutate();
  Flip.from(state, { duration, ease: 'power2.out', absolute: true, stagger: 0.01 });
}

/** Обратно совместимый реэкспорт gsap для компонентов */
export { gsap };
