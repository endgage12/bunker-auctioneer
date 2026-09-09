<template>
  <div class="h-screen flex flex-col">
    <TopNav />
    <div class="flex-1 min-h-0 overflow-y-auto">
      <div class="max-w-[1500px] mx-auto p-6">
        <div class="mb-5">
          <h1 class="text-xl font-bold">Тайный Санта</h1>
          <p class="text-sm text-slate-400">
            Перетаскивайте предметы из инвентаря в ящик — они исчезнут навсегда.
            <span v-if="isTouch">На телефоне просто касайтесь: сначала предмета, затем подсвеченной клетки.</span>
            После минимум {{ SANTA_MIN_ITEMS }} вложений ящик принесёт случайный дроп:
            чем дороже вложения, тем выше шанс редкого предмета.
          </p>
        </div>

        <!-- статус круга (sticky — таймер всегда на виду) -->
        <div class="panel mb-6 sticky top-0 z-30 flex flex-wrap items-center gap-x-8 gap-y-3 px-5 py-4">
          <div>
            <div class="text-xs text-slate-400 uppercase tracking-wide">Вложено за круг</div>
            <div class="text-xl font-mono text-amber-300">
              <template v-if="sacrificedCount < SANTA_MIN_ITEMS">
                {{ sacrificedCount }}/{{ SANTA_MIN_ITEMS }} предметов
              </template>
              <template v-else>{{ sacrificedCount }} предметов</template>
              · {{ fmt(poolValue) }}
            </div>
          </div>
          <div v-if="active">
            <div class="text-xs text-slate-400 uppercase tracking-wide">Дроп через</div>
            <div class="text-xl font-mono text-emerald-300">
              {{ remainingSec }} сек
              <span class="text-xs text-slate-400 font-sans">(таймер круга: {{ timerSec }} сек)</span>
            </div>
          </div>
          <div v-else-if="sacrificedCount > 0" class="text-sm text-slate-300">
            Добавьте ещё {{ needMore }} {{ plural(needMore, 'предмет', 'предмета', 'предметов') }}
            — круг запустится после {{ SANTA_MIN_ITEMS }}-го вложения
          </div>
          <div v-else class="text-sm text-slate-400">
            Ящик ждёт подношений — перетащите предмет из инвентаря в свободные клетки ящика
          </div>

          <!-- выбранный предмет (тап-режим на тач-устройствах) -->
          <div v-if="selectedItem" class="w-full flex flex-wrap items-center gap-3 border-t border-slate-800 pt-3">
            <span
              class="inline-block h-2.5 w-2.5 rounded-full shrink-0"
              :style="{ background: RARITY_HEX[selectedItem.rarity] }"
            ></span>
            <span class="text-sm text-slate-100 font-medium">{{ selectedItem.name }}</span>
            <span class="text-xs text-slate-400">
              {{ RARITY_LABEL[selectedItem.rarity] }} · {{ fmt(selectedItem.value) }} · {{ selectedItem.w }}×{{ selectedItem.h }}
            </span>
            <span class="text-xs text-emerald-300">
              {{ selTarget === 'box' ? 'тапните по подсвеченной клетке ящика' : 'тапните по подсвеченной клетке инвентаря' }}
            </span>
            <button class="btn-small ml-auto" @click="clearSelection">Отмена</button>
          </div>
        </div>

        <div v-if="!profile || !santa" class="text-slate-400">Загрузка…</div>
        <!-- на мобильных стек в обратном порядке: ящик сверху, инвентарь снизу;
             на десктопе — инвентарь слева, ящик справа -->
        <div v-else class="flex flex-col-reverse lg:flex-row lg:items-start gap-8 pb-8">
          <!-- левая часть: инвентарь игрока -->
          <div class="shrink-0">
            <div class="flex items-baseline justify-between mb-2 max-w-[794px]">
              <h2 class="font-semibold">Инвентарь</h2>
              <span class="text-xs text-slate-400">
                {{ inventory.length }} предметов ·
                <span class="text-amber-300 font-mono">{{ fmt(invTotal) }}</span>
              </span>
            </div>
            <div
              ref="invEl"
              class="inv-grid"
              :style="invGridStyle"
              @dragover.prevent="onInvDragOver"
              @dragleave="onInvDragLeave"
              @drop.prevent="onInvDrop"
              @click="onInvCellClick"
            >
              <div
                v-for="cell in invCellCount"
                :key="'i' + cell"
                class="inv-cell"
                :class="{ 'cell-valid': selTarget === 'inv' && validAnchors.has(cellKey(INV_COLS, cell)) }"
              ></div>
              <div
                v-for="p in invLayout.items"
                :key="p.it.id"
                class="inv-item rounded transition-opacity"
                :class="{ 'opacity-50': dragId === p.it.id, 'item-selected': selectedItem && selectedItem.id === p.it.id }"
                :style="invItemStyle(p)"
                :title="p.it.name + ' ' + p.it.w + 'x' + p.it.h + ' — ' + fmt(p.it.value)"
                draggable="true"
                @dragstart="onDragStart($event, 'inv', p.it.id)"
                @dragend="onDragEnd"
                @click.stop="onInvItemClick(p.it)"
              >
                <ItemCard :name="p.it.name" :rarity="p.it.rarity" :value="p.it.value" :def-id="p.it.defId" dense />
              </div>
              <div
                v-if="hoverTarget && hoverTarget.grid === 'inv'"
                class="absolute pointer-events-none rounded-md border-2 z-20"
                :class="hoverTarget.ok ? 'border-emerald-400 bg-emerald-400/20' : 'border-rose-500 bg-rose-500/20'"
                :style="hoverStyle"
              ></div>
            </div>
            <!-- переполнение инвентаря -->
            <div v-if="invLayout.overflow.length" class="mt-3 max-w-[794px]">
              <div class="text-xs text-rose-300 mb-2">
                Нет места в сетке ({{ invLayout.overflow.length }}) — их тоже можно вкладывать
              </div>
              <div class="flex flex-wrap gap-2">
                <div
                  v-for="it in invLayout.overflow"
                  :key="it.id"
                  class="w-16 h-16 rounded overflow-hidden ring-1 ring-rose-500/50 cursor-grab"
                  :class="{ 'item-selected': selectedItem && selectedItem.id === it.id }"
                  :title="it.name + ' ' + it.w + 'x' + it.h + ' — ' + fmt(it.value)"
                  draggable="true"
                  @dragstart="onDragStart($event, 'inv', it.id)"
                  @dragend="onDragEnd"
                  @click="onInvItemClick(it)"
                >
                  <ItemCard :name="it.name" :rarity="it.rarity" :value="it.value" :def-id="it.defId" dense />
                </div>
              </div>
            </div>
          </div>

          <!-- правая часть: ящик 9x9 -->
          <div class="shrink-0">
            <div class="flex items-baseline justify-between mb-2 max-w-[596px]">
              <h2 class="font-semibold">Ящик Тайного Санты</h2>
              <span class="text-xs text-slate-400">сетка 9×9</span>
            </div>
            <div
              ref="boxEl"
              class="santa-grid"
              :style="santaGridStyle"
              @dragover.prevent="onBoxDragOver"
              @dragleave="onBoxDragLeave"
              @drop.prevent="onBoxDrop"
              @click="onBoxCellClick"
            >
              <div
                v-for="cell in santaCellCount"
                :key="'s' + cell"
                class="inv-cell santa-cell"
                :class="{ 'cell-valid': selTarget === 'box' && validAnchors.has(cellKey(SANTA_COLS, cell)) }"
              ></div>
              <div
                v-for="it in boxItems"
                :key="it.id"
                class="inv-item rounded transition-opacity relative"
                :class="{ 'opacity-50': dragId === it.id, 'item-selected': selectedItem && selectedItem.id === it.id }"
                :style="santaItemStyle(it)"
                :title="it.name + ' ' + it.w + 'x' + it.h + ' — ' + fmt(it.value)"
                :draggable="it.kind === 'reward'"
                @dragstart="onDragStart($event, 'box', it.id)"
                @dragend="onDragEnd"
                @click.stop="onBoxItemClick(it)"
              >
                <ItemCard :name="it.name" :rarity="it.rarity" :value="it.value" :def-id="it.defId" dense />
                <span
                  v-if="it.kind === 'sacrifice'"
                  class="lock-badge absolute inset-0 flex items-center justify-center bg-slate-950/55 text-lg"
                  title="Вложено безвозвратно — дроп уже в пути"
                >🔒</span>
              </div>
              <div
                v-if="hoverTarget && hoverTarget.grid === 'box'"
                class="absolute pointer-events-none rounded-md border-2 z-20"
                :class="hoverTarget.ok ? 'border-emerald-400 bg-emerald-400/20' : 'border-rose-500 bg-rose-500/20'"
                :style="hoverStyle"
              ></div>
            </div>
            <!-- дроп, ожидающий свободного места -->
            <div v-if="santa.pending.length" class="mt-3 max-w-[596px]">
              <div class="text-xs text-slate-300 mb-2">
                Ждут свободного места в ящике ({{ santa.pending.length }}) — заберите дроп, чтобы освободить клетки
              </div>
              <div class="flex flex-wrap gap-2">
                <div
                  v-for="it in santa.pending"
                  :key="it.id"
                  class="w-16 h-16 rounded overflow-hidden ring-1 ring-amber-400/60"
                  :title="it.name + ' ' + it.w + 'x' + it.h + ' — ' + fmt(it.value)"
                >
                  <ItemCard :name="it.name" :rarity="it.rarity" :value="it.value" :def-id="it.defId" dense />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- модальное окно: итоги завершённого круга -->
    <div
      v-if="cycleModal"
      class="fixed inset-0 z-[10000] bg-black/60 flex items-center justify-center p-4"
      @click.self="closeCycleModal"
    >
      <div class="panel p-6 w-96 max-w-full">
        <h3 class="font-semibold mb-1">Итоги круга Тайного Санты</h3>
        <p class="text-xs text-slate-400 mb-4">Ящик завершил круг и принёс подарки</p>
        <div class="flex flex-col gap-3 text-sm">
          <div class="flex items-baseline justify-between gap-4">
            <span class="text-slate-400 shrink-0">Вложено</span>
            <span class="text-right">
              {{ cycleModal.itemsIn }} {{ plural(cycleModal.itemsIn, 'предмет', 'предмета', 'предметов') }}
              · <span class="text-amber-300 font-mono">{{ fmt(cycleModal.valueIn) }}</span>
            </span>
          </div>
          <div class="flex items-baseline justify-between gap-4">
            <span class="text-slate-400 shrink-0">Получено</span>
            <span class="text-right">
              {{ cycleModal.itemsOut }} {{ plural(cycleModal.itemsOut, 'предмет', 'предмета', 'предметов') }}
              · <span class="text-amber-300 font-mono">{{ fmt(cycleModal.valueOut) }}</span>
            </span>
          </div>
          <div class="h-px bg-slate-700"></div>
          <div class="flex items-baseline justify-between gap-4">
            <span class="text-slate-400 shrink-0">Разница</span>
            <span
              class="font-mono font-semibold"
              :class="cycleDiff >= 0 ? 'text-emerald-300' : 'text-rose-400'"
            >
              {{ cycleDiff >= 0 ? '+' : '−' }}{{ fmt(Math.abs(cycleDiff)) }}
            </span>
          </div>
        </div>
        <button class="btn-primary w-full mt-5" @click="closeCycleModal">Забрать</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { fmt, INV_COLS, INV_ROWS, RARITY_LABEL, SANTA_COLS, SANTA_MIN_ITEMS, SANTA_ROWS, santaTimerMs } from '@auctioneer/shared';
import type { InventoryRow, Profile, SantaBoxItem, SantaCycleResult, SantaState } from '@auctioneer/shared';
import { RARITY_HEX } from '../lib/rarity';
import { get, post } from '../lib/api';
import { useAuthStore } from '../stores/auth';
import { useGameStore } from '../stores/game';
import TopNav from '../components/TopNav.vue';
import ItemCard from '../components/ItemCard.vue';

const auth = useAuthStore();
const game = useGameStore();

const GAP = 2;
const PAD = 2;

/** Тач-устройство: drag&drop недоступен, работает тап-режим */
const isTouch = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;

const profile = ref<Profile | null>(null);
const santa = ref<SantaState | null>(null);
const invEl = ref<HTMLElement | null>(null);
const boxEl = ref<HTMLElement | null>(null);
const nowTs = ref(Date.now());

const inventory = computed<InventoryRow[]>(() => profile.value?.inventory ?? []);
const invTotal = computed(() => inventory.value.reduce((s, i) => s + i.value, 0));
const boxItems = computed<SantaBoxItem[]>(() => santa.value?.box ?? []);
const poolValue = computed(() => santa.value?.poolValue ?? 0);
const deadline = computed(() => santa.value?.deadline ?? null);
const active = computed(() => deadline.value !== null);
const sacrificedCount = computed(() => boxItems.value.filter((b) => b.kind === 'sacrifice').length);
const needMore = computed(() => Math.max(0, SANTA_MIN_ITEMS - sacrificedCount.value));

// ---------- тап-режим (тач-устройства): выбор предмета и клетки ----------

const selected = ref<{ source: 'inv' | 'box'; id: string } | null>(null);

/** Куда тапать после выбора: выбрали в инвентаре — тапаем в ящик и наоборот */
const selTarget = computed<'inv' | 'box' | null>(() =>
  selected.value ? (selected.value.source === 'inv' ? 'box' : 'inv') : null,
);

const selectedItem = computed<InventoryRow | SantaBoxItem | null>(() => {
  const sel = selected.value;
  if (!sel) return null;
  if (sel.source === 'inv') return inventory.value.find((i) => i.id === sel.id) ?? null;
  return boxItems.value.find((i) => i.id === sel.id) ?? null;
});

/** Ячейки-цели, куда выбранный предмет поместится (подсветка зелёным) */
const validAnchors = computed<Set<string>>(() => {
  const sel = selected.value;
  if (!sel || !isTouch) return new Set<string>();
  const out = new Set<string>();
  if (sel.source === 'inv') {
    const it = inventory.value.find((i) => i.id === sel.id);
    if (!it) return out;
    for (let y = 0; y < SANTA_ROWS; y++) {
      for (let x = 0; x < SANTA_COLS; x++) {
        const ax = Math.min(x, SANTA_COLS - it.w);
        const ay = Math.min(y, SANTA_ROWS - it.h);
        if (boxFree(ax, ay, it.w, it.h)) out.add(x + ',' + y);
      }
    }
  } else {
    const it = boxItems.value.find((i) => i.id === sel.id);
    if (!it) return out;
    for (let y = 0; y < INV_ROWS; y++) {
      for (let x = 0; x < INV_COLS; x++) {
        const ax = Math.min(x, INV_COLS - it.w);
        const ay = Math.min(y, INV_ROWS - it.h);
        if (invFree(ax, ay, it.w, it.h)) out.add(x + ',' + y);
      }
    }
  }
  return out;
});

function clearSelection(): void {
  selected.value = null;
}

function scrollToGrid(which: 'inv' | 'box'): void {
  const el = which === 'inv' ? invEl.value : boxEl.value;
  el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function onInvItemClick(it: InventoryRow): void {
  if (!isTouch) return;
  if (selected.value?.source === 'inv' && selected.value.id === it.id) {
    clearSelection();
    return;
  }
  selected.value = { source: 'inv', id: it.id };
  scrollToGrid('box');
}

function onBoxItemClick(it: SantaBoxItem): void {
  if (!isTouch) return;
  if (it.kind !== 'reward') {
    game.pushToast('Вложение уже нельзя забрать — дроп в пути', 'error');
    return;
  }
  if (selected.value?.source === 'box' && selected.value.id === it.id) {
    clearSelection();
    return;
  }
  selected.value = { source: 'box', id: it.id };
  scrollToGrid('inv');
}

function onInvCellClick(e: MouseEvent): void {
  if (!isTouch || !invEl.value || !selected.value || selected.value.source !== 'box') return;
  if ((e.target as HTMLElement).closest('.inv-item')) return;
  const it = boxItems.value.find((i) => i.id === selected.value!.id);
  if (!it) {
    clearSelection();
    return;
  }
  const cell = cellFromPoint(invEl.value, INV_COLS, INV_ROWS, e.clientX, e.clientY);
  const x = Math.min(cell.x, INV_COLS - it.w);
  const y = Math.min(cell.y, INV_ROWS - it.h);
  if (!invFree(x, y, it.w, it.h)) {
    game.pushToast('Место в инвентаре занято', 'error');
    return;
  }
  void takeAt(it, x, y);
}

function onBoxCellClick(e: MouseEvent): void {
  if (!isTouch || !boxEl.value || !selected.value || selected.value.source !== 'inv') return;
  if ((e.target as HTMLElement).closest('.inv-item')) return;
  const it = inventory.value.find((i) => i.id === selected.value!.id);
  if (!it) {
    clearSelection();
    return;
  }
  const cell = cellFromPoint(boxEl.value, SANTA_COLS, SANTA_ROWS, e.clientX, e.clientY);
  const x = Math.min(cell.x, SANTA_COLS - it.w);
  const y = Math.min(cell.y, SANTA_ROWS - it.h);
  if (!boxFree(x, y, it.w, it.h)) {
    game.pushToast('Место в ящике занято', 'error');
    return;
  }
  void sacrificeAt(it, x, y);
}

/** Если выбранный предмет исчез (круг завершился) — снимаем выбор */
watch(selectedItem, (v) => {
  if (!v && selected.value) selected.value = null;
});

// итоги завершённого круга (модальное окно)
const cycleModal = ref<SantaCycleResult | null>(null);
const cycleDiff = computed(() =>
  cycleModal.value ? cycleModal.value.valueOut - cycleModal.value.valueIn : 0,
);

function seenCycleKey(): string {
  return 'santa_last_cycle_' + (auth.meId || 'anon');
}

function closeCycleModal(): void {
  cycleModal.value = null;
}

/** Склонение: plural(1, 'предмет', 'предмета', 'предметов') */
function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
const timerSec = computed(() =>
  poolValue.value > 0 ? Math.round(santaTimerMs(poolValue.value) / 1000) : 0,
);
const remainingSec = computed(() => {
  const d = deadline.value;
  if (d === null) return 0;
  return Math.max(0, Math.ceil((d - nowTs.value) / 1000));
});

// ---------- раскладка инвентаря (как на странице инвентаря) ----------

interface PackedItem {
  it: InventoryRow;
  x: number;
  y: number;
}

const invLayout = computed<{ items: PackedItem[]; overflow: InventoryRow[] }>(() => {
  const occ = new Set<string>();
  const out: PackedItem[] = [];
  const overflow: InventoryRow[] = [];
  const withPos = inventory.value.filter((i) => i.invX !== undefined && i.invY !== undefined);
  const loose = inventory.value.filter((i) => i.invX === undefined || i.invY === undefined);
  const mark = (x: number, y: number, w: number, h: number): void => {
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) occ.add(x + dx + ',' + (y + dy));
    }
  };
  const fits = (x: number, y: number, w: number, h: number): boolean => {
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        if (x + dx >= INV_COLS || y + dy >= INV_ROWS) return false;
        if (occ.has(x + dx + ',' + (y + dy))) return false;
      }
    }
    return true;
  };
  for (const it of withPos) {
    const x = it.invX ?? 0;
    const y = it.invY ?? 0;
    out.push({ it, x, y });
    mark(x, y, it.w, it.h);
  }
  for (const it of loose) {
    let placed = false;
    outer: for (let y = 0; y < INV_ROWS && !placed; y++) {
      for (let x = 0; x < INV_COLS; x++) {
        if (fits(x, y, it.w, it.h)) {
          out.push({ it, x, y });
          mark(x, y, it.w, it.h);
          placed = true;
          break outer;
        }
      }
    }
    if (!placed) overflow.push(it);
  }
  return { items: out, overflow };
});

const invCellCount = INV_COLS * INV_ROWS;
const santaCellCount = SANTA_COLS * SANTA_ROWS;

// сетки масштабируются через CSS-переменную --cell: 64px на десктопе,
// на узких экранах — ужимаются под ширину окна
const invGridStyle = computed(() => ({
  gridTemplateColumns: 'repeat(' + INV_COLS + ', var(--cell))',
  gridAutoRows: 'var(--cell)',
  gap: GAP + 'px',
  width: 'calc(' + INV_COLS + ' * var(--cell) + ' + ((INV_COLS - 1) * GAP + PAD * 2) + 'px)',
  height: 'calc(' + INV_ROWS + ' * var(--cell) + ' + ((INV_ROWS - 1) * GAP + PAD * 2) + 'px)',
}));

const santaGridStyle = computed(() => ({
  gridTemplateColumns: 'repeat(' + SANTA_COLS + ', var(--cell))',
  gridAutoRows: 'var(--cell)',
  gap: GAP + 'px',
  width: 'calc(' + SANTA_COLS + ' * var(--cell) + ' + ((SANTA_COLS - 1) * GAP + PAD * 2) + 'px)',
  height: 'calc(' + SANTA_ROWS + ' * var(--cell) + ' + ((SANTA_ROWS - 1) * GAP + PAD * 2) + 'px)',
}));

function invItemStyle(p: PackedItem): Record<string, string> {
  return {
    gridColumn: p.x + 1 + ' / span ' + p.it.w,
    gridRow: p.y + 1 + ' / span ' + p.it.h,
  };
}

function santaItemStyle(it: SantaBoxItem): Record<string, string> {
  const x = it.x ?? 0;
  const y = it.y ?? 0;
  return {
    gridColumn: x + 1 + ' / span ' + it.w,
    gridRow: y + 1 + ' / span ' + it.h,
  };
}

// ---------- drag & drop ----------

const dragId = ref<string | null>(null);
const dragSource = ref<'inv' | 'box' | null>(null);
const hoverTarget = ref<{ grid: 'inv' | 'box'; x: number; y: number; w: number; h: number; ok: boolean; cellPx: number } | null>(null);

function onDragStart(e: DragEvent, source: 'inv' | 'box', itemId: string): void {
  dragSource.value = source;
  dragId.value = itemId;
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', itemId);
  }
}

function onDragEnd(): void {
  dragId.value = null;
  dragSource.value = null;
  hoverTarget.value = null;
}

function draggedSantaItem(): SantaBoxItem | null {
  if (dragSource.value !== 'box' || !dragId.value) return null;
  return boxItems.value.find((i) => i.id === dragId.value) ?? null;
}

function draggedInvItem(): InventoryRow | null {
  if (dragSource.value !== 'inv' || !dragId.value) return null;
  return inventory.value.find((i) => i.id === dragId.value) ?? null;
}

/** Клетка сетки по координатам (cellPx — фактический размер ячейки, сетка масштабируется на мобильных) */
function cellFromPoint(
  el: HTMLElement,
  cols: number,
  rows: number,
  clientX: number,
  clientY: number,
): { x: number; y: number; cellPx: number } {
  const rect = el.getBoundingClientRect();
  const cellPx = (rect.width - PAD * 2 - (cols - 1) * GAP) / cols;
  const px = clientX - rect.left - PAD;
  const py = clientY - rect.top - PAD;
  const x = Math.max(0, Math.min(cols - 1, Math.floor(px / (cellPx + GAP))));
  const y = Math.max(0, Math.min(rows - 1, Math.floor(py / (cellPx + GAP))));
  return { x, y, cellPx };
}

/** Ключ клетки для подсветки валидных ячеек (индекс в v-for начинается с 1) */
function cellKey(cols: number, oneBasedIdx: number): string {
  const i = oneBasedIdx - 1;
  return (i % cols) + ',' + Math.floor(i / cols);
}

function invFree(x: number, y: number, w: number, h: number): boolean {
  for (const p of invLayout.value.items) {
    if (x < p.x + p.it.w && x + w > p.x && y < p.y + p.it.h && y + h > p.y) return false;
  }
  return true;
}

function boxFree(x: number, y: number, w: number, h: number): boolean {
  for (const it of boxItems.value) {
    const bx = it.x ?? 0;
    const by = it.y ?? 0;
    if (x < bx + it.w && x + w > bx && y < by + it.h && y + h > by) return false;
  }
  return true;
}

function onInvDragOver(e: DragEvent): void {
  const it = draggedSantaItem();
  if (!it || !invEl.value) return;
  const cell = cellFromPoint(invEl.value, INV_COLS, INV_ROWS, e.clientX, e.clientY);
  const x = Math.min(cell.x, INV_COLS - it.w);
  const y = Math.min(cell.y, INV_ROWS - it.h);
  hoverTarget.value = { grid: 'inv', x, y, w: it.w, h: it.h, ok: invFree(x, y, it.w, it.h), cellPx: cell.cellPx };
}

function onInvDragLeave(e: DragEvent): void {
  const el = invEl.value;
  if (!el) return;
  const related = e.relatedTarget as Node | null;
  if (!related || !el.contains(related)) hoverTarget.value = null;
}

function onBoxDragOver(e: DragEvent): void {
  const it = draggedInvItem();
  if (!it || !boxEl.value) return;
  const cell = cellFromPoint(boxEl.value, SANTA_COLS, SANTA_ROWS, e.clientX, e.clientY);
  const x = Math.min(cell.x, SANTA_COLS - it.w);
  const y = Math.min(cell.y, SANTA_ROWS - it.h);
  hoverTarget.value = { grid: 'box', x, y, w: it.w, h: it.h, ok: boxFree(x, y, it.w, it.h), cellPx: cell.cellPx };
}

function onBoxDragLeave(e: DragEvent): void {
  const el = boxEl.value;
  if (!el) return;
  const related = e.relatedTarget as Node | null;
  if (!related || !el.contains(related)) hoverTarget.value = null;
}

const hoverStyle = computed(() => {
  const t = hoverTarget.value;
  if (!t) return {};
  const c = t.cellPx;
  return {
    left: t.x * (c + GAP) + PAD + 'px',
    top: t.y * (c + GAP) + PAD + 'px',
    width: t.w * (c + GAP) - GAP + 'px',
    height: t.h * (c + GAP) - GAP + 'px',
  };
});

async function onInvDrop(): Promise<void> {
  const it = draggedSantaItem();
  const t = hoverTarget.value;
  if (!it || !t || t.grid !== 'inv') return;
  onDragEnd();
  if (!t.ok) {
    game.pushToast('Место в инвентаре занято', 'error');
    return;
  }
  await takeAt(it, t.x, t.y);
}

async function onBoxDrop(): Promise<void> {
  const it = draggedInvItem();
  const t = hoverTarget.value;
  if (!it || !t || t.grid !== 'box') return;
  onDragEnd();
  if (!t.ok) {
    game.pushToast('Место в ящике занято', 'error');
    return;
  }
  await sacrificeAt(it, t.x, t.y);
}

/** Забрать дроп из ящика в инвентарь (общий путь для DnD и тап-режима) */
async function takeAt(it: SantaBoxItem, x: number, y: number): Promise<void> {
  clearSelection();
  try {
    await post('/api/santa/take', { itemId: it.id, x, y });
    game.pushToast('«' + it.name + '» забран в инвентарь');
    await refresh();
  } catch (e) {
    game.pushToast((e as Error).message, 'error');
    await refresh();
  }
}

/** Безвозвратно вложить предмет в ящик (общий путь для DnD и тап-режима) */
async function sacrificeAt(it: InventoryRow, x: number, y: number): Promise<void> {
  clearSelection();
  try {
    await post('/api/santa/sacrifice', { itemId: it.id, x, y });
    await refresh();
    if (!santa.value) return;
    const placed = santa.value.box.filter((b) => b.kind === 'sacrifice').length;
    if (placed < SANTA_MIN_ITEMS) {
      const left = SANTA_MIN_ITEMS - placed;
      game.pushToast(
        '«' + it.name + '» безвозвратно вложен — нужно ещё ' + left + ' ' + plural(left, 'предмет', 'предмета', 'предметов') + ' для запуска круга',
      );
    } else {
      const sec = Math.round(santaTimerMs(santa.value.poolValue) / 1000);
      game.pushToast('«' + it.name + '» безвозвратно вложен — дроп через ' + sec + ' сек');
    }
  } catch (e) {
    game.pushToast((e as Error).message, 'error');
    await refresh();
  }
}

// ---------- загрузка и таймер ----------

let refreshPromise: Promise<void> | null = null;

function refresh(): Promise<void> {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      try {
        profile.value = await auth.fetchMe();
        const st = await get<SantaState>('/api/santa');
        santa.value = st;
        // новый завершённый круг -> модальное окно с итогами (один раз на круг)
        const lc = st.lastCycle;
        if (lc && localStorage.getItem(seenCycleKey()) !== lc.id) {
          localStorage.setItem(seenCycleKey(), lc.id);
          cycleModal.value = lc;
        }
      } catch (e) {
        game.pushToast((e as Error).message, 'error');
      } finally {
        refreshPromise = null;
      }
    })();
  }
  return refreshPromise;
}

let tickTimer: number | undefined;

onMounted(async () => {
  await refresh();
  tickTimer = window.setInterval(() => {
    nowTs.value = Date.now();
    const d = santa.value?.deadline;
    if (d !== null && d !== undefined && Date.now() >= d) void refresh();
  }, 250);
});

onBeforeUnmount(() => {
  if (tickTimer !== undefined) window.clearInterval(tickTimer);
});
</script>

<style scoped>
.inv-grid,
.santa-grid {
  position: relative;
  display: grid;
  background: #1e293b;
  border: 1px solid #334155;
  border-radius: 0.5rem;
  padding: 2px;
}
/* ячейка: 64px на десктопе, на узких экранах ужимается под ширину окна (p-6 = 48px) */
.inv-grid {
  --cell: min(64px, calc((100vw - 48px) / 12));
}
.santa-grid {
  --cell: min(64px, calc((100vw - 48px) / 9));
  background: #241a0a;
  border-color: #92400e;
  box-shadow: 0 0 24px rgba(180, 83, 9, 0.15);
}
.inv-cell {
  width: var(--cell);
  height: var(--cell);
  background: #0f172a;
  border: 1px solid #1e293b;
  border-radius: 2px;
  transition: background 0.15s ease;
}
.santa-cell {
  background: #1c1408;
  border-color: #3b2c10;
}
/* валидные клетки в тап-режиме */
.cell-valid {
  background: rgba(52, 211, 153, 0.3);
  border-color: rgba(52, 211, 153, 0.6);
}
.santa-cell.cell-valid {
  background: rgba(52, 211, 153, 0.22);
}
.inv-item {
  position: relative;
  z-index: 5;
  overflow: hidden;
  cursor: grab;
}
.inv-item:active {
  cursor: grabbing;
}
/* выбранный предмет в тап-режиме */
.item-selected {
  z-index: 8;
  outline: 2px solid #fbbf24;
  outline-offset: -2px;
  box-shadow: 0 0 12px rgba(251, 191, 36, 0.5);
}
/* на маленьких экранах в карточке остаётся только иконка, детали — в статус-панели */
@media (max-width: 560px) {
  .inv-item :deep(.item-card-inner > div) {
    display: none;
  }
  .inv-item :deep(.item-card-inner) {
    padding: 1px;
  }
  .lock-badge {
    font-size: 12px;
  }
}
</style>
