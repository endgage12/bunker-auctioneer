<template>
  <div class="panel flex flex-col min-h-0 h-full">
    <div class="flex items-center justify-between mb-2 shrink-0">
      <h3 class="text-sm font-semibold text-slate-200 truncate">{{ title }}</h3>
      <span class="text-xs text-slate-500 hidden sm:block ml-2 shrink-0">{{ subtitle }}</span>
    </div>
    <div
      ref="viewport"
      class="flex items-center justify-center overflow-hidden"
      :class="fit === 'width' ? 'h-auto' : 'flex-1 min-h-0'"
    >
      <div class="relative shrink-0" :style="sizerStyle">
        <div
          class="board-grid"
          :style="gridStyle"
          @mouseleave="hoverIdx = -1"
        >
          <!-- ячейки 64x64 -->
          <div
            v-for="(cell, idx) in board.cells"
            :key="'c' + idx"
            class="board-cell"
            :class="cellClass(cell, idx)"
            @click="onCellClick(idx)"
            @mouseenter="hoverIdx = idx"
          ></div>

          <!-- раскрытые предметы -->
          <div
            v-for="it in revealedItems"
            :key="it.id"
            class="board-item flip-in rounded overflow-hidden"
            :class="clickableItem(it) ? 'cursor-pointer' : ''"
            :style="itemStyle(it)"
            :title="tooltip(it)"
            @click="onItemClick(it)"
          >
            <ItemCard :name="it.name ?? ''" :rarity="it.rarity ?? 'white'" :value="it.value" dense />
          </div>

          <!-- подсветка открытого лота (граница компенсирует масштаб: всегда 2px на экране) -->
          <div
            v-if="openLot"
            class="absolute pointer-events-none rounded-md lot-open"
            :style="lotRectStyle(openLot)"
          ></div>

          <!-- превью размещения -->
          <div
            v-if="preview"
            class="absolute pointer-events-none rounded-md border-2"
            :class="preview.ok ? 'border-emerald-400 bg-emerald-400/20' : 'border-rose-500 bg-rose-500/20'"
            :style="previewRect(preview)"
          ></div>

          <!-- бегущая рамка вокруг нераскрытых предметов (GSAP) -->
          <svg
            v-for="r in hiddenRects"
            :key="'f' + r.itemId"
            ref="frameEls"
            class="hidden-frame absolute pointer-events-none"
            :style="frameRectStyle(r)"
            :width="frameSize(r).w"
            :height="frameSize(r).h"
          >
            <rect x="1" y="1" :width="frameSize(r).w - 2" :height="frameSize(r).h - 2" :rx="FRAME_R" />
          </svg>

          <!-- личные подсказки о редкости скрытых предметов (карточки-анализаторы) -->
          <div
            v-for="r in rarityHintRects"
            :key="'hint' + r.itemId"
            class="rarity-hint absolute pointer-events-none rounded-md"
            :style="hintRectStyle(r)"
          >
            <span
              class="hint-chip"
              :style="{ borderColor: RARITY_HEX[r.rarity], color: RARITY_HEX[r.rarity] }"
            >
              <span class="hint-dot" :style="{ background: RARITY_HEX[r.rarity] }"></span>?
            </span>
          </div>
        </div>

        <!-- метки лотов (вне масштабируемой сетки — всегда читаемые) -->
        <div
          v-for="lot in lotChips"
          :key="'lot' + (lot.ownerId ? 'c' : 'p') + lot.index"
          class="board-chip-anchor"
          :style="chipStyle(lot)"
        >
          <span
            class="board-chip text-[10px] px-1.5 py-0.5 rounded border whitespace-nowrap"
            :class="lot.open
              ? 'bg-amber-500/90 text-slate-950 border-amber-300 font-bold'
              : 'bg-slate-900/90 border-slate-600 text-slate-300'"
          >
            {{ chipLabel(lot) }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { gsap } from 'gsap';
import { fmt } from '@auctioneer/shared';
import type { PublicBoard, PublicCell, PublicItem, PublicLot, Rarity, RarityHint } from '@auctioneer/shared';
import { RARITY_HEX } from '../lib/rarity';
import ItemCard from './ItemCard.vue';

const CELL = 64;
const GAP = 2;
const PAD = 2;

const props = withDefaults(
  defineProps<{
    board: PublicBoard;
    items: PublicItem[];
    players?: { id: string; name: string }[];
    title: string;
    subtitle?: string;
    mode: 'place' | 'auction';
    myId?: string;
    selected?: { w: number; h: number } | null;
    /** 'both' — вписать целиком в доступную область; 'width' — по ширине (страница скроллится) */
    fit?: 'both' | 'width';
    /** личные подсказки: границы скрытых предметов подсвечиваются цветом редкости */
    rarityHints?: RarityHint[];
  }>(),
  { fit: 'both' },
);

const emit = defineEmits<{
  (e: 'cell-click', pos: { x: number; y: number }): void;
  (e: 'item-click', itemId: string): void;
}>();

const hoverIdx = ref(-1);
const viewport = ref<HTMLElement | null>(null);
const fitScale = ref(1);
let ro: ResizeObserver | null = null;

const naturalW = computed(() => props.board.w * CELL + (props.board.w - 1) * GAP + PAD * 2);
const naturalH = computed(() => props.board.h * CELL + (props.board.h - 1) * GAP + PAD * 2);

function measure(): void {
  const el = viewport.value;
  if (!el) return;
  const w = el.clientWidth;
  const h = el.clientHeight;
  if (w <= 0) return;
  const s =
    props.fit === 'width'
      ? Math.min(1, w / naturalW.value)
      : h <= 0
        ? Math.min(1, w / naturalW.value)
        : Math.min(1, w / naturalW.value, h / naturalH.value);
  if (Math.abs(s - fitScale.value) > 0.0005) fitScale.value = s;
}

onMounted(() => {
  measure();
  syncFrames();
  if (typeof ResizeObserver !== 'undefined' && viewport.value) {
    ro = new ResizeObserver(() => measure());
    ro.observe(viewport.value);
  }
});
onBeforeUnmount(() => {
  ro?.disconnect();
  ro = null;
  for (const t of frameTweens) t.kill();
  frameTweens = [];
});

const revealedItems = computed(() =>
  props.items.filter((i) => i.revealed && i.x !== undefined && i.y !== undefined),
);

const openLot = computed<PublicLot | null>(() => props.board.lots.find((l) => l.open) ?? null);
const lotChips = computed(() => props.board.lots.filter((l) => !l.done));

function chipLabel(lot: PublicLot): string {
  if (lot.open) return 'ТОРГИ';
  if (lot.ownerId) {
    const owner = props.players?.find((p) => p.id === lot.ownerId);
    return owner ? 'Лот: ' + owner.name : 'Лот ' + (lot.index + 1);
  }
  return 'Лот ' + (lot.index + 1);
}

function chipStyle(lot: PublicLot): Record<string, string> {
  const w = props.board.w || 1;
  const h = props.board.h || 1;
  return {
    left: ((lot.x + lot.w / 2) / w) * 100 + '%',
    top: ((lot.y + lot.h / 2) / h) * 100 + '%',
  };
}

function lotRectStyle(lot: PublicLot): Record<string, string> {
  const w = props.board.w || 1;
  const h = props.board.h || 1;
  return {
    left: (lot.x / w) * 100 + '%',
    top: (lot.y / h) * 100 + '%',
    width: (lot.w / w) * 100 + '%',
    height: (lot.h / h) * 100 + '%',
    // толщина рамки не зависит от масштаба стола
    border: 'calc(2px / var(--bs, 1)) solid #fbbf24',
  };
}

function itemStyle(it: PublicItem): Record<string, string> {
  return {
    gridColumn: (it.x ?? 0) + 1 + ' / span ' + (it.w ?? 1),
    gridRow: (it.y ?? 0) + 1 + ' / span ' + (it.h ?? 1),
  };
}

function tooltip(it: PublicItem): string {
  return it.name + ' ' + it.w + 'x' + it.h + ' — ' + fmt(it.value ?? 0);
}

const gridStyle = computed(() => ({
  gridTemplateColumns: 'repeat(' + props.board.w + ', ' + CELL + 'px)',
  gridAutoRows: CELL + 'px',
  gap: GAP + 'px',
  width: naturalW.value + 'px',
  height: naturalH.value + 'px',
  transform: 'scale(' + fitScale.value + ')',
  transformOrigin: 'top left',
}));

const sizerStyle = computed(() => ({
  '--bs': String(fitScale.value),
  width: Math.round(naturalW.value * fitScale.value) + 'px',
  height: Math.round(naturalH.value * fitScale.value) + 'px',
}));

const preview = computed(() => {
  if (props.mode !== 'place' || !props.selected || hoverIdx.value < 0) return null;
  const w = props.board.w;
  const x = hoverIdx.value % w;
  const y = Math.floor(hoverIdx.value / w);
  const rect = { x, y, w: props.selected.w, h: props.selected.h };
  const inBounds = x >= 0 && y >= 0 && x + rect.w <= w && y + rect.h <= props.board.h;
  const overlap = revealedItems.value.some((it) => {
    const ix = it.x ?? 0;
    const iy = it.y ?? 0;
    const iw = it.w ?? 1;
    const ih = it.h ?? 1;
    return x < ix + iw && x + rect.w > ix && y < iy + ih && y + rect.h > iy;
  });
  return { ...rect, ok: inBounds && !overlap };
});

function previewRect(p: { x: number; y: number; w: number; h: number }): Record<string, string> {
  const w = props.board.w || 1;
  const h = props.board.h || 1;
  return {
    left: (p.x / w) * 100 + '%',
    top: (p.y / h) * 100 + '%',
    width: (p.w / w) * 100 + '%',
    height: (p.h / h) * 100 + '%',
  };
}

interface HiddenRect { itemId: string; x: number; y: number; w: number; h: number }

/** Прямоугольники всех нераскрытых предметов: closed-клетки, сгруппированные по itemId */
function closedItemRects(): HiddenRect[] {
  const out: HiddenRect[] = [];
  const seen = new Set<string>();
  const w = props.board.w;
  props.board.cells.forEach((c, idx) => {
    if (c.kind !== 'closed' || !c.itemId || seen.has(c.itemId)) return;
    seen.add(c.itemId);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -1;
    let maxY = -1;
    props.board.cells.forEach((c2, idx2) => {
      if (c2.kind === 'closed' && c2.itemId === c.itemId) {
        const x = idx2 % w;
        const y = Math.floor(idx2 / w);
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    });
    out.push({ itemId: c.itemId, x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 });
  });
  return out;
}

/** Рамки всех нераскрытых предметов (по границе бегает полоса) */
const hiddenRects = computed(() => closedItemRects());

/** Прямоугольники скрытых предметов, редкость которых раскрыта лично игроку */
const rarityHintRects = computed(() => {
  const hints = props.rarityHints ?? [];
  if (hints.length === 0) return [];
  const ids = new Set(hints.map((h) => h.itemId));
  return closedItemRects()
    .filter((r) => ids.has(r.itemId))
    .map((r) => ({ ...r, rarity: hints.find((h) => h.itemId === r.itemId)!.rarity }));
});

function hintRectStyle(r: { x: number; y: number; w: number; h: number; rarity: Rarity }): Record<string, string> {
  const w = props.board.w || 1;
  const h = props.board.h || 1;
  const c = RARITY_HEX[r.rarity];
  return {
    left: (r.x / w) * 100 + '%',
    top: (r.y / h) * 100 + '%',
    width: (r.w / w) * 100 + '%',
    height: (r.h / h) * 100 + '%',
    // толщина рамки не зависит от масштаба стола
    border: 'calc(2px / var(--bs, 1)) solid ' + c,
    background: c + '24',
    boxShadow: '0 0 calc(14px / var(--bs, 1)) ' + c + '55',
  };
}

const FRAME_R = 6;

/** Размер рамки в пикселях сетки (клетки + промежутки) */
function frameSize(r: HiddenRect): { w: number; h: number } {
  return { w: r.w * CELL + (r.w - 1) * GAP, h: r.h * CELL + (r.h - 1) * GAP };
}

function frameRectStyle(r: HiddenRect): Record<string, string> {
  return {
    left: PAD + r.x * (CELL + GAP) + 'px',
    top: PAD + r.y * (CELL + GAP) + 'px',
  };
}

/** Периметр скруглённой рамки — чтобы цикл бегущей полосы был бесшовным */
function framePerimeter(r: HiddenRect): number {
  const s = frameSize(r);
  return 2 * (s.w - 2 * FRAME_R) + 2 * (s.h - 2 * FRAME_R) + 2 * Math.PI * FRAME_R;
}

const frameEls = ref<SVGSVGElement[]>([]);
let frameTweens: gsap.core.Tween[] = [];
let lastFrameKeys = '';

/** Запустить (или перезапустить) бегущую полосу на всех рамках */
function syncFrames(): void {
  for (const t of frameTweens) t.kill();
  frameTweens = [];
  const rects = hiddenRects.value;
  frameEls.value.forEach((svg, i) => {
    const r = rects[i];
    if (!r) return;
    const rect = svg.querySelector('rect');
    if (!rect) return;
    const p = framePerimeter(r);
    const dash = Math.max(14, Math.round(p * 0.16));
    rect.setAttribute('stroke-dasharray', dash + ' ' + (p - dash));
    rect.setAttribute('stroke-dashoffset', '0');
    frameTweens.push(
      gsap.to(rect, {
        strokeDashoffset: -p,
        duration: 2.4,
        ease: 'none',
        repeat: -1,
      }),
    );
  });
}

// перезапускаем полосу только когда состав рамок реально изменился
watch(hiddenRects, () => {
  const keys = hiddenRects.value
    .map((r) => r.itemId + ':' + r.x + ':' + r.y + ':' + r.w + ':' + r.h)
    .join('|');
  if (keys === lastFrameKeys) return;
  lastFrameKeys = keys;
  void nextTick().then(syncFrames);
});

function cellClass(cell: PublicCell, idx: number): string {
  const cls = ['board-cell'];
  if (cell.kind === 'closed') cls.push('cell-closed');
  if (cell.kind === 'empty' || cell.kind === 'item') {
    if (props.mode === 'place' && props.selected) cls.push('clickable');
    if (idx === hoverIdx.value && props.mode === 'place' && props.selected) {
      cls.push(preview.value?.ok ? 'cell-hover-ok' : 'cell-hover-bad');
    }
  }
  return cls.join(' ');
}

function clickableItem(it: PublicItem): boolean {
  return props.mode === 'place' && it.ownerId === props.myId;
}

function onCellClick(idx: number): void {
  if (props.mode !== 'place') return;
  const x = idx % props.board.w;
  const y = Math.floor(idx / props.board.w);
  emit('cell-click', { x, y });
}

function onItemClick(it: PublicItem): void {
  if (clickableItem(it)) emit('item-click', it.id);
}
</script>

<style scoped>
.board-grid {
  position: absolute;
  top: 0;
  left: 0;
  display: grid;
  background: #1e293b;
  border: 1px solid #334155;
  border-radius: 0.5rem;
  padding: 2px;
  overflow: hidden;
}
.board-cell {
  width: 64px;
  height: 64px;
  background: #0f172a;
  border: 1px solid #1e293b;
  border-radius: 2px;
  transition: background 0.15s ease;
}
.board-cell.cell-closed {
  background: #111827;
  background-image: radial-gradient(circle, #334155 1px, transparent 1.5px);
  background-size: 8px 8px;
}
.board-cell.cell-hover-ok {
  background: rgba(52, 211, 153, 0.3);
}
.board-cell.cell-hover-bad {
  background: rgba(244, 63, 94, 0.3);
}
.board-cell.clickable {
  cursor: pointer;
}
.board-cell.clickable:hover {
  background: #1e293b;
}
.rarity-hint {
  z-index: 15;
  animation: hint-pulse 1.6s ease-in-out infinite;
}
.hidden-frame {
  z-index: 10;
  overflow: visible;
}
.hidden-frame rect {
  fill: none;
  stroke: #38bdf8;
  stroke-width: 2;
  stroke-linecap: round;
  opacity: 0.85;
  filter: drop-shadow(0 0 3px rgba(56, 189, 248, 0.5));
}
@keyframes hint-pulse {
  0%, 100% { opacity: 0.65; }
  50% { opacity: 1; }
}
.hint-chip {
  position: absolute;
  top: calc(-9px / var(--bs, 1));
  left: calc(50% - 14px);
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 6px;
  border-radius: 999px;
  background: rgba(2, 6, 23, 0.9);
  border: 1px solid;
  font-size: 10px;
  font-weight: 700;
  line-height: 1.2;
}
.hint-dot {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  display: inline-block;
}
.board-item {
  position: relative;
  z-index: 5;
}
.board-chip-anchor {
  position: absolute;
  z-index: 20;
  pointer-events: none;
}
.board-chip {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
}
</style>
