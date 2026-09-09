<template>
  <div class="panel flex flex-col min-h-0 h-full">
    <div class="flex items-center justify-between mb-2 shrink-0">
      <h3 class="text-sm font-semibold text-slate-200">{{ title }}</h3>
      <span class="text-xs text-slate-500">{{ subtitle }}</span>
    </div>
    <div class="flex-1 min-h-0 flex items-start justify-center overflow-auto">
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

        <!-- подсветка открытого лота -->
        <div
          v-if="openLot"
          class="absolute pointer-events-none rounded-md lot-open border-2 border-amber-400"
          :style="lotRectStyle(openLot)"
        ></div>

        <!-- метки лотов -->
        <div
          v-for="lot in lotChips"
          :key="'lot' + (lot.ownerId ? 'c' : 'p') + lot.index"
          class="absolute pointer-events-none text-[10px] px-1.5 py-0.5 rounded -translate-x-1/2 -translate-y-1/2 border"
          :class="lot.open
            ? 'bg-amber-500/90 text-slate-950 border-amber-300 font-bold'
            : 'bg-slate-900/90 border-slate-600 text-slate-300'"
          :style="chipStyle(lot)"
        >
          {{ chipLabel(lot) }}
        </div>

        <!-- превью размещения -->
        <div
          v-if="preview"
          class="absolute pointer-events-none rounded-md border-2"
          :class="preview.ok ? 'border-emerald-400 bg-emerald-400/20' : 'border-rose-500 bg-rose-500/20'"
          :style="previewRect(preview)"
        ></div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { fmt } from '@auctioneer/shared';
import type { PublicBoard, PublicCell, PublicItem, PublicLot } from '@auctioneer/shared';
import ItemCard from './ItemCard.vue';

const CELL = 64;
const GAP = 2;
const PAD = 2;

const props = defineProps<{
  board: PublicBoard;
  items: PublicItem[];
  players?: { id: string; name: string }[];
  title: string;
  subtitle?: string;
  mode: 'place' | 'auction';
  myId?: string;
  selected?: { w: number; h: number } | null;
}>();

const emit = defineEmits<{
  (e: 'cell-click', pos: { x: number; y: number }): void;
  (e: 'item-click', itemId: string): void;
}>();

const hoverIdx = ref(-1);

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
  width: (props.board.w * CELL + (props.board.w - 1) * GAP + PAD * 2) + 'px',
  height: (props.board.h * CELL + (props.board.h - 1) * GAP + PAD * 2) + 'px',
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
  position: relative;
  display: grid;
  background: #1e293b;
  border: 1px solid #334155;
  border-radius: 0.5rem;
  padding: 2px;
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
.board-cell.clickable:hover {
  background: #1e293b;
}
.board-item {
  position: relative;
  z-index: 5;
}
</style>
