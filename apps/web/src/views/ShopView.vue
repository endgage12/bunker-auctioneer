<template>
  <div class="h-screen flex flex-col">
    <TopNav />
    <div
      class="page-wide w-full py-4 sm:py-6 flex flex-col lg:flex-row xl:grid xl:grid-cols-[minmax(0,520px)_minmax(0,1fr)] 2xl:grid-cols-[minmax(0,640px)_minmax(0,1fr)] gap-6 xl:gap-8 flex-1 min-h-0 overflow-y-auto"
    >
      <!-- Левая колонка: билет, комплекты, коллекция -->
      <aside class="lg:w-96 shrink-0 flex flex-col gap-4">
        <div class="panel p-4">
          <h3 class="font-semibold text-sm mb-2">🎟️ Билет на крутку</h3>
          <div class="flex items-center gap-3">
            <img
              v-if="vaseIcon"
              :src="vaseIcon"
              alt=""
              class="w-14 h-14 object-contain rounded-lg bg-slate-800/60 p-1.5 shrink-0 select-none"
              draggable="false"
            />
            <div class="text-sm min-w-0">
              <div>1 крутка = 1 «{{ state?.ticketName ?? 'Пыльная ваза' }}»</div>
              <div class="text-xs text-slate-400 mt-0.5">
                В инвентаре:
                <b class="text-amber-300 font-mono">{{ state?.vaseCount ?? 0 }}</b>
              </div>
            </div>
          </div>
          <p class="text-xs text-slate-500 mt-2 leading-relaxed">
            «Пыльные вазы» выпадают из случайных дропов, продаются на барахолке и у торговца.
            За каждую вазу — одна крутка колеса фортуны.
          </p>
        </div>

        <div v-for="set in CARD_SETS" :key="set.id" class="panel p-4">
          <h3 class="font-semibold text-sm mb-1">{{ set.icon }} {{ set.name }}</h3>
          <p class="text-xs text-slate-400 mb-3 leading-relaxed">{{ set.desc }}</p>
          <div class="flex flex-col gap-1.5">
            <div
              v-for="c in cardsOf(set.id)"
              :key="c.id"
              class="flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5"
              :style="cardRowStyle(c)"
            >
              <span class="text-xs font-medium min-w-0 truncate" :title="c.name">{{ c.name }}</span>
              <span class="text-[10px] text-slate-400 shrink-0 font-mono">{{ chancePct(c) }}%</span>
            </div>
          </div>
        </div>

        <div class="panel p-4">
          <h3 class="font-semibold text-sm mb-2">🗂️ Моя коллекция</h3>
          <p v-if="(state?.cards ?? []).length === 0" class="text-xs text-slate-500">
            Карточек пока нет — крутите колесо!
          </p>
          <div v-else class="flex flex-col gap-1.5">
            <div
              v-for="c in state?.cards ?? []"
              :key="c.cardId"
              class="flex items-center justify-between gap-2 text-xs"
            >
              <span class="truncate">{{ cardName(c.cardId) }}</span>
              <span class="text-amber-300 font-mono shrink-0">×{{ c.count }}</span>
            </div>
          </div>
          <p class="text-[10px] text-slate-500 mt-2">
            Анализаторы применяются в партии, усилители — на странице
            <router-link to="/inventory" class="text-amber-300 hover:underline">инвентаря</router-link>.
          </p>
        </div>
      </aside>

      <!-- Правая колонка: колесо фортуны -->
      <main class="flex-1 min-w-0 flex flex-col items-center gap-4 pb-8">
        <div class="panel p-5 w-full max-w-xl flex flex-col items-center gap-4">
          <h2 class="text-xl font-bold">🎡 Колесо фортуны</h2>
          <p class="text-xs text-slate-400 text-center leading-relaxed">
            Колесо крутится <b class="text-slate-200">5 секунд</b> и приносит случайную карточку.
            Чем сильнее карточка — тем меньше шанс её выпадения.
          </p>

          <div ref="stageEl" class="relative wheel-stage" :class="{ 'is-spinning': spinning }">
            <!-- стрелка-указатель -->
            <div ref="arrowEl" class="wheel-pointer">
              <div class="wheel-pointer-shape"></div>
            </div>
            <!-- вращающаяся часть -->
            <div ref="rotorEl" class="wheel-rotor will-change-transform">
              <svg :viewBox="'0 0 ' + SIZE + ' ' + SIZE" class="w-full h-full select-none">
                <!-- внешнее кольцо -->
                <circle :cx="C" :cy="C" :r="RIM_R + 6" fill="#0f172a" stroke="#334155" stroke-width="3" />
                <!-- секторы -->
                <path
                  v-for="(seg, si) in segments"
                  :key="seg.card.id"
                  :ref="(el) => setSegmentEl(el as Element | null, si)"
                  :d="seg.path"
                  :fill="seg.color"
                  stroke="#0f172a"
                  stroke-width="2"
                />
                <!-- разделительные бусины по ободу -->
                <circle
                  v-for="seg in segments"
                  :key="'b' + seg.card.id"
                  :cx="seg.edgeX"
                  :cy="seg.edgeY"
                  r="5"
                  fill="#fbbf24"
                  stroke="#0f172a"
                  stroke-width="2"
                />
                <!-- подписи секторов -->
                <text
                  v-for="seg in segments"
                  :key="'t' + seg.card.id"
                  :x="seg.labelX"
                  :y="seg.labelY"
                  :transform="seg.labelTransform"
                  text-anchor="middle"
                  dominant-baseline="middle"
                  class="wheel-label"
                >
                  {{ seg.short }}
                </text>
                <!-- ступица -->
                <circle :cx="C" :cy="C" r="30" fill="#1e293b" stroke="#f59e0b" stroke-width="3" />
                <circle :cx="C" :cy="C" r="12" fill="#f59e0b" />
                <circle :cx="C" :cy="C" r="5" fill="#0f172a" />
              </svg>
            </div>
          </div>

          <button
            class="btn-primary w-full max-w-sm text-base"
            :disabled="spinning || (state?.vaseCount ?? 0) < 1"
            @click="spin"
          >
            <template v-if="spinning">Колесо крутится…</template>
            <template v-else-if="(state?.vaseCount ?? 0) < 1">Нужна «Пыльная ваза»</template>
            <template v-else>Крутить колесо (1 ваза)</template>
          </button>
          <router-link to="/inventory" class="text-xs text-slate-500 hover:text-amber-300 transition">
            Полученные карточки хранятся в инвентаре →
          </router-link>
        </div>
      </main>
    </div>

    <!-- Модальное окно результата -->
    <div
      v-if="result"
      class="fixed inset-0 z-[10000] bg-black/75 flex items-center justify-center p-4"
      @click.self="closeResult"
    >
      <div class="panel p-6 w-80 max-w-full text-center result-pop relative overflow-hidden">
        <div
          class="pointer-events-none absolute inset-0"
          :style="resultGlowStyle"
        ></div>
        <div class="relative">
          <div class="text-4xl mb-2">{{ setIcon(result.setId) }}</div>
          <div class="text-[10px] uppercase tracking-widest text-slate-400 mb-1">
            {{ setName(result.setId) }}
          </div>
          <div class="font-bold text-lg mb-2">{{ result.cardName }}</div>
          <p class="text-xs text-slate-400 leading-relaxed mb-5">{{ resultDesc }}</p>
          <button class="btn-primary w-full" @click="closeResult">Забрать</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { gsap, motionOK } from '../lib/animations';
import { CARD_SETS, CARD_DEFS, WHEEL_SEGMENTS, WHEEL_SPIN_MS, cardChance } from '@auctioneer/shared';
import type { CardDef } from '@auctioneer/shared';
import { get, post } from '../lib/api';
import { itemIconUrl } from '../lib/items';
import { useGameStore } from '../stores/game';
import TopNav from '../components/TopNav.vue';

interface PlayerCardGroup {
  cardId: string;
  count: number;
}

interface ShopState {
  cards: PlayerCardGroup[];
  vaseCount: number;
  ticketDefId: string;
  ticketName: string;
  ticketValue: number;
}

interface SpinResponse {
  ok: boolean;
  cardId?: string;
  cardName?: string;
  setId?: 'analyzers' | 'amplifiers';
  instanceId?: string;
}

const game = useGameStore();

const state = ref<ShopState | null>(null);
const spinning = ref(false);
const rotorEl = ref<HTMLElement | null>(null);
const stageEl = ref<HTMLElement | null>(null);
const arrowEl = ref<HTMLElement | null>(null);
const segmentEls = ref<HTMLElement[]>([]);
function setSegmentEl(el: Element | null, i: number): void {
  if (el) segmentEls.value[i] = el as HTMLElement;
}
const result = ref<SpinResponse | null>(null);

const vaseIcon = itemIconUrl('white-0');

// ---------- геометрия колеса ----------

const SIZE = 440;
const C = SIZE / 2;
const RIM_R = 202;
const LABEL_R = 118;

function polar(a: number, r: number): { x: number; y: number } {
  const rad = (a * Math.PI) / 180;
  return { x: C + r * Math.sin(rad), y: C - r * Math.cos(rad) };
}

function sectorPath(a1: number, a2: number): string {
  const p1 = polar(a1, RIM_R);
  const p2 = polar(a2, RIM_R);
  return 'M ' + C + ' ' + C + ' L ' + p1.x.toFixed(2) + ' ' + p1.y.toFixed(2) +
    ' A ' + RIM_R + ' ' + RIM_R + ' 0 0 1 ' + p2.x.toFixed(2) + ' ' + p2.y.toFixed(2) + ' Z';
}

const SEGMENT_COLORS: Record<string, string> = {
  'analyzer-small': '#38bdf8',
  'analyzer-medium': '#22d3ee',
  'analyzer-large': '#818cf8',
  'analyzer-perfect': '#c084fc',
  'amp-blue': '#60a5fa',
  'amp-yellow': '#eab308',
  'amp-gold': '#f59e0b',
  'amp-red': '#ef4444',
};

const SHORT_NAMES: Record<string, string> = {
  'analyzer-small': 'Малый анализатор',
  'analyzer-medium': 'Средний анализатор',
  'analyzer-large': 'Большой анализатор',
  'analyzer-perfect': 'Соверш. анализатор',
  'amp-blue': 'Синий усилитель',
  'amp-yellow': 'Жёлтый усилитель',
  'amp-gold': 'Золотой усилитель',
  'amp-red': 'Красный усилитель',
};

const segments = computed(() =>
  WHEEL_SEGMENTS.map((card, i) => {
    const a1 = i * 45;
    const a2 = a1 + 45;
    const a = a1 + 22.5;
    const lp = polar(a, LABEL_R);
    const ep = polar(a1, RIM_R);
    // радиальная подпись; на левой половине — переворот, чтобы не читать вверх ногами
    const flip = a > 90 && a < 270;
    return {
      card,
      path: sectorPath(a1, a2),
      color: SEGMENT_COLORS[card.id] ?? '#64748b',
      labelX: lp.x,
      labelY: lp.y,
      labelTransform: 'rotate(' + (flip ? a + 90 : a - 90) + ' ' + lp.x + ' ' + lp.y + ')',
      edgeX: ep.x,
      edgeY: ep.y,
      short: SHORT_NAMES[card.id] ?? card.name,
    };
  }),
);

// текущий накопленный поворот колеса
const rot = { v: 0 };
let tween: gsap.core.Tween | null = null;

function applyRotation(): void {
  if (rotorEl.value) rotorEl.value.style.transform = 'rotate(' + rot.v + 'deg)';
}

/** Угол, на который нужно довернуть колесо, чтобы сектор idx оказался под стрелкой */
function rotationToSegment(idx: number, spins: number, jitter: number): number {
  const center = idx * 45 + 22.5;
  const current = ((rot.v % 360) + 360) % 360;
  const rest = (360 - ((center + current) % 360)) % 360;
  return spins * 360 + rest + jitter;
}

// ---------- данные ----------

const defById = new Map(CARD_DEFS.map((d) => [d.id, d]));

function cardName(id: string): string {
  return defById.get(id)?.name ?? id;
}

function cardDef(id: string): CardDef | undefined {
  return defById.get(id);
}

function cardsOf(setId: string): CardDef[] {
  return CARD_DEFS.filter((c) => c.setId === setId);
}

function chancePct(c: CardDef): string {
  return cardChance(c).toFixed(1).replace('.', ',');
}

function setIcon(setId: string | undefined): string {
  return CARD_SETS.find((s) => s.id === setId)?.icon ?? '🃏';
}

function setName(setId: string | undefined): string {
  return CARD_SETS.find((s) => s.id === setId)?.name ?? '';
}

const resultDesc = computed(() => (result.value?.cardId ? defById.get(result.value.cardId)?.desc ?? '' : ''));

const resultGlowStyle = computed(() => {
  const c = result.value?.cardId ? SEGMENT_COLORS[result.value.cardId] : '#f59e0b';
  return {
    background:
      'radial-gradient(circle at 50% 0%, ' + c + '33 0%, transparent 70%)',
  };
});

function cardRowStyle(c: CardDef): Record<string, string> {
  const color = SEGMENT_COLORS[c.id] ?? '#64748b';
  return { borderColor: color + '66', background: color + '14' };
}

async function loadState(): Promise<void> {
  try {
    state.value = await get<ShopState>('/api/shop');
  } catch {
    /* guard уже авторизован */
  }
}

// ---------- крутка ----------

async function spin(): Promise<void> {
  if (spinning.value) return;
  spinning.value = true;
  try {
    const resp = await post<SpinResponse>('/api/shop/spin');
    if (!resp.ok || !resp.cardId) {
      game.pushToast('Не удалось крутануть колесо', 'error');
      spinning.value = false;
      await loadState();
      return;
    }
    await loadState();
    const idx = WHEEL_SEGMENTS.findIndex((c) => c.id === resp.cardId);
    const jitter = (Math.random() * 2 - 1) * 13;
    const target = rot.v + rotationToSegment(idx, 5, jitter);
    // Рывок сцены на старте и затухающая тряска — ощущение физического толчка
    if (motionOK && stageEl.value) {
      gsap.fromTo(stageEl.value, { scale: 1 }, { scale: 0.965, duration: 0.16, yoyo: true, repeat: 1, ease: 'power2.inOut' });
    }
    tween = gsap.to(rot, {
      v: target,
      duration: WHEEL_SPIN_MS / 1000,
      ease: 'power4.out',
      onUpdate: applyRotation,
      onComplete: () => {
        spinning.value = false;
        // выигрыш показываем только после остановки колеса — сохраняем интригу
        result.value = resp;
        // «щелчок» стрелки и вспышка выигравшего сектора
        if (motionOK) {
          if (arrowEl.value) {
            gsap.fromTo(arrowEl.value, { y: -4 }, { y: 0, duration: 0.5, ease: 'elastic.out(1, 0.35)' });
          }
          const seg = segmentEls.value[idx];
          if (seg) {
            gsap.fromTo(
              seg,
              { opacity: 0.35 },
              { opacity: 1, duration: 0.22, yoyo: true, repeat: 3, ease: 'power2.inOut' },
            );
          }
        }
      },
    });
  } catch (e) {
    game.pushToast((e as Error).message, 'error');
    spinning.value = false;
    await loadState();
  }
}

function closeResult(): void {
  result.value = null;
}

onMounted(async () => {
  await loadState();
});

onBeforeUnmount(() => {
  tween?.kill();
  tween = null;
});
</script>

<style scoped>
.wheel-stage {
  position: relative;
  width: min(100%, 460px);
  aspect-ratio: 1;
}
.wheel-rotor {
  width: 100%;
  height: 100%;
}
.wheel-pointer {
  position: absolute;
  top: -6px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 10;
  filter: drop-shadow(0 2px 6px rgba(0, 0, 0, 0.6));
}
.wheel-pointer-shape {
  width: 0;
  height: 0;
  border-left: 18px solid transparent;
  border-right: 18px solid transparent;
  border-top: 30px solid #fbbf24;
}
.wheel-stage.is-spinning .wheel-rotor {
  filter: drop-shadow(0 0 18px rgba(251, 191, 36, 0.35));
}
.wheel-label {
  fill: #020617;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.01em;
  pointer-events: none;
}
.result-pop {
  animation: result-pop 0.35s cubic-bezier(0.34, 1.56, 0.64, 1) both;
}
@keyframes result-pop {
  from {
    transform: scale(0.7);
    opacity: 0;
  }
  to {
    transform: scale(1);
    opacity: 1;
  }
}
</style>
