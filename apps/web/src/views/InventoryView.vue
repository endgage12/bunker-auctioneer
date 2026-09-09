<template>
  <div class="h-screen flex flex-col">
    <TopNav />
    <div class="max-w-6xl w-full mx-auto p-6 flex flex-col flex-1 min-h-0">
      <div class="mb-5">
        <div>
          <h1 class="text-xl font-bold">Инвентарь</h1>
          <p class="text-sm text-slate-400">
            {{ inventory.length }} предметов · сумма
            <span class="text-amber-300 font-mono"><CoinAmount :value="totalValue" /></span>
            · перетаскивайте предметы по сетке
          </p>
        </div>
        <div class="mt-4 flex flex-wrap items-center gap-3">
          <input
            v-model="query"
            class="input-dark sm:w-[26rem]"
            placeholder="Поиск по названию или редкости (от 2 символов)…"
          />
          <button class="btn-ghost shrink-0" @click="autoSort">Автосортировка</button>
          <button class="btn-danger shrink-0" :disabled="inventory.length === 0" @click="sellAllOpen = true">
            Продать всё
          </button>
          <span v-if="searching" class="text-xs text-slate-400 ml-auto shrink-0">
            найдено: <b class="text-amber-300">{{ matchedCount }}</b> из {{ inventory.length }}
          </span>
        </div>
      </div>

      <div v-if="!profile" class="text-slate-400">Загрузка…</div>
      <template v-else>
        <!-- инвентарь: своя область прокрутки; карточки — отдельным блоком ниже -->
        <div class="flex-1 min-h-0 overflow-y-auto pr-2" @scroll="closeMenu">
        <!-- переполнение: важный блок, всегда самым первым сверху -->
        <div v-if="layout.overflow.length" class="panel p-4 mb-4 !border-rose-500/60">
          <div class="flex items-center gap-2 mb-1">
            <span class="text-lg">⚠️</span>
            <h2 class="font-semibold text-sm">Переполнение инвентаря</h2>
            <span class="text-xs px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 font-mono">{{ layout.overflow.length }}</span>
          </div>
          <p class="text-xs text-slate-400 mb-3">
            Этим предметам не хватило места в сетке. Освободите ячейки (перетащите или продайте что-нибудь) — предметы вернутся в сетку автоматически.
          </p>
          <div class="flex flex-wrap gap-2">
            <div
              v-for="it in layout.overflow"
              :key="it.id"
              class="w-16 h-16 rounded overflow-hidden ring-1 ring-rose-500/50"
              :title="it.name + ' ' + it.w + 'x' + it.h + ' — ' + fmt(it.value)"
              @contextmenu.prevent.stop="openMenu($event, it)"
              @click.capture="guardItemClick"
            >
              <ItemCard :name="it.name" :rarity="it.rarity" :value="it.value" :def-id="it.defId" dense />
            </div>
          </div>
        </div>

        <div v-if="inventory.length === 0" class="text-slate-500 mb-4">
          Инвентарь пуст — загляните на <router-link to="/market" class="text-amber-300 hover:underline">барахолку</router-link>
        </div>
        <div v-else class="w-fit">
          <div
            ref="gridEl"
            class="inv-grid"
            :style="gridStyle"
            @dragover.prevent="onDragOver"
            @dragleave="onDragLeave"
            @drop.prevent="onDrop"
            @contextmenu.prevent="closeMenu"
          >
            <!-- ячейки 64x64, сетка 12x24 -->
            <div v-for="cell in cellCount" :key="'c' + cell" class="inv-cell"></div>

            <!-- предметы поверх ячеек -->
            <div
              v-for="p in layout.items"
              :key="p.it.id"
              class="inv-item rounded transition-all duration-200"
              :class="[itemClass(p.it), dragId === p.it.id ? 'opacity-60' : '']"
              :style="itemStyle(p)"
              :title="p.it.name + ' ' + p.it.w + 'x' + p.it.h + ' — ' + fmt(p.it.value)"
              draggable="true"
              @dragstart="onDragStart($event, p.it.id)"
              @dragend="onDragEnd"
              @contextmenu.prevent.stop="openMenu($event, p.it)"
              @click.capture="guardItemClick"
            >
              <ItemCard :name="p.it.name" :rarity="p.it.rarity" :value="p.it.value" :def-id="p.it.defId" dense />
            </div>

            <!-- превью места при перетаскивании -->
            <div
              v-if="hoverTarget"
              class="absolute pointer-events-none rounded-md border-2 z-20"
              :class="hoverTarget.ok ? 'border-emerald-400 bg-emerald-400/20' : 'border-rose-500 bg-rose-500/20'"
              :style="hoverStyle"
            ></div>
          </div>

        </div>
      </div>

        <!-- особые карточки: отдельный блок ниже инвентаря, вне его прокрутки -->
        <div class="shrink-0 mt-4 pt-4 border-t border-slate-800">
          <h2 class="text-lg font-bold mb-1">🃏 Особые карточки</h2>
          <p class="text-xs text-slate-400 mb-3">
            Карточки выпадают из колеса фортуны в <router-link to="/shop" class="text-amber-300 hover:underline">магазине</router-link>.
            Анализаторы применяются во время партии, усилители — прямо здесь.
          </p>
          <div class="max-h-[38dvh] overflow-y-auto pr-2">
          <div v-if="!cardsLoaded" class="text-xs text-slate-500">Загрузка карточек…</div>
          <div v-else-if="cards.length === 0" class="text-sm text-slate-500">
            Карточек пока нет — загляните в <router-link to="/shop" class="text-amber-300 hover:underline">магазин</router-link> и крутаните колесо фортуны.
          </div>
          <div v-else class="flex flex-col gap-4">
            <div v-for="set in cardSets" :key="set.id" class="panel p-4">
              <div class="flex items-center gap-2 mb-2">
                <span class="text-lg">{{ set.icon }}</span>
                <h3 class="font-semibold text-sm">{{ set.name }}</h3>
              </div>
              <p class="text-xs text-slate-400 mb-3">{{ set.desc }}</p>
              <div class="flex flex-col gap-2">
                <div
                  v-for="c in ownedCardsOf(set.id)"
                  :key="c.cardId"
                  class="flex items-center gap-3 rounded-lg border border-slate-700/70 bg-slate-800/40 px-3 py-2"
                >
                  <div class="min-w-0 flex-1">
                    <div class="text-sm font-medium truncate">{{ cardName(c.cardId) }}</div>
                    <div class="text-[11px] text-slate-400 leading-snug">{{ cardDesc(c.cardId) }}</div>
                  </div>
                  <span class="text-amber-300 font-mono text-sm shrink-0">×{{ c.count }}</span>
                  <button
                    v-if="isAmplifier(c.cardId)"
                    class="btn-small shrink-0 px-3"
                    :disabled="busyCard === c.cardId"
                    @click="useAmplifier(c.cardId)"
                  >
                    Использовать
                  </button>
                  <span v-else class="text-[10px] text-slate-500 shrink-0">в партии</span>
                </div>
              </div>
            </div>
          </div>
          </div>
        </div>
      </template>

      <!-- контекстное меню предмета -->
      <template v-if="ctxMenu">
        <div class="fixed inset-0 z-[9998]" @click="closeMenu" @contextmenu.prevent="closeMenu"></div>
        <div
          class="fixed z-[9999] w-56 rounded-lg border border-slate-700 bg-slate-900 py-1 shadow-xl shadow-black/50"
          :style="{ left: ctxMenu.x + 'px', top: ctxMenu.y + 'px' }"
        >
          <div class="px-3 py-1.5 text-xs text-slate-400 truncate border-b border-slate-800 mb-1">
            {{ ctxMenu.it.name }} · <CoinAmount :value="ctxMenu.it.value" />
          </div>
          <button class="w-full text-left px-3 py-2 text-sm text-slate-200 hover:bg-slate-800 transition" @click="openListDialog">
            Выставить на аукцион
          </button>
          <button class="w-full text-left px-3 py-2 text-sm text-slate-200 hover:bg-slate-800 transition" @click="sellItem">
            Продать
          </button>
        </div>
      </template>

      <!-- диалог: продать всё -->
      <div v-if="sellAllOpen" class="fixed inset-0 z-[10000] bg-black/60 flex items-center justify-center p-4" @click.self="sellAllOpen = false">
        <div class="panel p-5 w-80">
          <h3 class="font-semibold mb-1">Продать всё торговцу?</h3>
          <p class="text-xs text-slate-400 mb-4">
            {{ inventory.length }} предметов инвентаря будут проданы по номиналу за
            <span class="text-amber-300 font-mono"><CoinAmount :value="totalValue" /></span>.
            Предметы в партии, на барахолке и в витрине не затрагиваются.
          </p>
          <div class="flex justify-end gap-2">
            <button class="btn-ghost" @click="sellAllOpen = false">Отмена</button>
            <button class="btn-danger" :disabled="sellAllBusy || inventory.length === 0" @click="sellAll">
              {{ sellAllBusy ? 'Продаём…' : 'Продать' }}
            </button>
          </div>
        </div>
      </div>

      <!-- диалог: выставить на аукцион -->
      <div v-if="listItem" class="fixed inset-0 z-[10000] bg-black/60 flex items-center justify-center p-4" @click.self="listItem = null">
        <div class="panel p-5 w-80">
          <h3 class="font-semibold mb-1">Выставить на аукцион</h3>
          <p class="text-xs text-slate-400 mb-4 truncate">{{ listItem.name }} · номинал <CoinAmount :value="listItem.value" /></p>
          <input
            v-model.number="listPrice"
            type="number"
            min="1"
            class="input-dark mb-4"
            placeholder="Цена"
            @keyup.enter="confirmList"
          />
          <div class="flex justify-end gap-2">
            <button class="btn-ghost" @click="listItem = null">Отмена</button>
            <button class="btn-primary" :disabled="!listPrice || listPrice < 1" @click="confirmList">Выставить</button>
          </div>
        </div>
      </div>

    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { fmt, INV_COLS, INV_ROWS, RARITY_LABEL, CARD_DEFS, CARD_SETS } from '@auctioneer/shared';
import type { InventoryRow, ItemInstance, Profile } from '@auctioneer/shared';
import { get, post } from '../lib/api';
import { useAuthStore } from '../stores/auth';
import { useGameStore } from '../stores/game';
import TopNav from '../components/TopNav.vue';
import CoinAmount from '../components/CoinAmount.vue';
import ItemCard from '../components/ItemCard.vue';

const auth = useAuthStore();
const game = useGameStore();

const CELL = 64;
const GAP = 2;
const PAD = 2;

const profile = ref<Profile | null>(null);
const query = ref('');
const gridEl = ref<HTMLElement | null>(null);
const dragId = ref<string | null>(null);
const hoverTarget = ref<{ x: number; y: number; w: number; h: number; ok: boolean } | null>(null);

// ---------- особые карточки ----------

interface OwnedCard {
  cardId: string;
  count: number;
}

const cards = ref<OwnedCard[]>([]);
const cardsLoaded = ref(false);
const busyCard = ref<string | null>(null);
const cardSets = CARD_SETS;
const cardDefById = new Map(CARD_DEFS.map((d) => [d.id, d]));

function cardName(id: string): string {
  return cardDefById.get(id)?.name ?? id;
}

function cardDesc(id: string): string {
  return cardDefById.get(id)?.desc ?? '';
}

function isAmplifier(id: string): boolean {
  return cardDefById.get(id)?.setId === 'amplifiers';
}

function ownedCardsOf(setId: string): OwnedCard[] {
  return cards.value.filter((c) => cardDefById.get(c.cardId)?.setId === setId);
}

async function loadCards(): Promise<void> {
  try {
    cards.value = await get<OwnedCard[]>('/api/cards');
  } catch {
    /* ignore */
  }
  cardsLoaded.value = true;
}

/** Применить усилитель: случайный предмет слабее цели -> случайный предмет нужного качества */
async function useAmplifier(cardId: string): Promise<void> {
  if (busyCard.value) return;
  busyCard.value = cardId;
  try {
    const res = await post<{ ok: boolean; removed?: { name: string; rarity: string; value: number }; item?: ItemInstance }>(
      '/api/cards/amplify',
      { cardId },
    );
    const removed = res.removed;
    const item = res.item;
    if (removed && item) {
      game.pushToast('«' + removed.name + '» → «' + item.name + '» (' + RARITY_LABEL[item.rarity] + ')');
    }
    await loadCards();
    profile.value = await auth.fetchMe();
  } catch (err) {
    game.pushToast((err as Error).message, 'error');
  }
  busyCard.value = null;
}

const inventory = computed<InventoryRow[]>(() => profile.value?.inventory ?? []);
const totalValue = computed(() => inventory.value.reduce((s, i) => s + i.value, 0));

// поиск работает только от 2 символов
const searching = computed(() => query.value.trim().length >= 2);

function matches(it: InventoryRow): boolean {
  const q = query.value.trim().toLowerCase();
  if (q.length < 2) return true;
  return it.name.toLowerCase().includes(q) || RARITY_LABEL[it.rarity].toLowerCase().includes(q);
}

const matchedCount = computed(() =>
  searching.value ? inventory.value.filter(matches).length : inventory.value.length,
);

interface PackedItem {
  it: InventoryRow;
  x: number;
  y: number;
}

// раскладка: сначала сохранённые позиции с сервера, затем свободные места; лишнее — в оверфлоу
const layout = computed<{ items: PackedItem[]; overflow: InventoryRow[] }>(() => {
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

// Адаптивная высота сетки: показываем только занятые строки (плюс небольшой запас),
// чтобы раздел «Особые карточки» был сразу под предметами, а не за 24 строками
// пустых ячеек. Во время перетаскивания сетка раскрывается до полных 24 строк —
// предмет по-прежнему можно положить в любую свободную клетку.
const MIN_GRID_ROWS = 8;
const EXTRA_GRID_ROWS = 2;

const dragging = computed(() => dragId.value !== null);

const gridRows = computed(() => {
  if (dragging.value) return INV_ROWS;
  let maxRow = 0;
  for (const p of layout.value.items) {
    maxRow = Math.max(maxRow, p.y + p.it.h);
  }
  return Math.min(INV_ROWS, Math.max(MIN_GRID_ROWS, maxRow + EXTRA_GRID_ROWS));
});

const cellCount = computed(() => INV_COLS * gridRows.value);

const gridStyle = computed(() => ({
  gridTemplateColumns: 'repeat(' + INV_COLS + ', ' + CELL + 'px)',
  gridAutoRows: CELL + 'px',
  gap: GAP + 'px',
  width: (INV_COLS * CELL + (INV_COLS - 1) * GAP + PAD * 2) + 'px',
  height: (gridRows.value * CELL + (gridRows.value - 1) * GAP + PAD * 2) + 'px',
}));

function itemStyle(p: PackedItem): Record<string, string> {
  return {
    gridColumn: p.x + 1 + ' / span ' + p.it.w,
    gridRow: p.y + 1 + ' / span ' + p.it.h,
  };
}

function itemClass(it: InventoryRow): string {
  if (!searching.value) return '';
  if (matches(it)) {
    return 'ring-2 ring-amber-400 shadow-[0_0_14px_rgba(251,191,36,0.45)]';
  }
  return 'opacity-40 brightness-[0.55]';
}

// ---------- drag & drop ----------

/** после перетаскивания браузер может выдать «клик» — глушим его, чтобы не открывалось окно деталей */
let dragClickGuardUntil = 0;

function guardItemClick(e: MouseEvent): void {
  if (Date.now() < dragClickGuardUntil) {
    e.stopPropagation();
    e.preventDefault();
  }
}

function onDragStart(e: DragEvent, itemId: string): void {
  dragId.value = itemId;
  dragClickGuardUntil = Date.now() + 350;
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', itemId);
  }
}

function onDragEnd(): void {
  dragId.value = null;
  hoverTarget.value = null;
  dragClickGuardUntil = Date.now() + 350;
}

function draggedItem(): PackedItem | null {
  if (!dragId.value) return null;
  return layout.value.items.find((p) => p.it.id === dragId.value) ?? null;
}

function cellFromEvent(e: DragEvent): { x: number; y: number } {
  const el = gridEl.value;
  if (!el) return { x: 0, y: 0 };
  const rect = el.getBoundingClientRect();
  const px = e.clientX - rect.left - PAD;
  const py = e.clientY - rect.top - PAD;
  const x = Math.max(0, Math.min(INV_COLS - 1, Math.floor(px / (CELL + GAP))));
  const y = Math.max(0, Math.min(INV_ROWS - 1, Math.floor(py / (CELL + GAP))));
  return { x, y };
}

function onDragOver(e: DragEvent): void {
  const item = draggedItem();
  if (!item) return;
  const cell = cellFromEvent(e);
  const x = Math.min(cell.x, INV_COLS - item.it.w);
  const y = Math.min(cell.y, INV_ROWS - item.it.h);
  const ok = isFree(x, y, item.it.w, item.it.h, item.it.id);
  hoverTarget.value = { x, y, w: item.it.w, h: item.it.h, ok };
}

function onDragLeave(e: DragEvent): void {
  const el = gridEl.value;
  if (!el) return;
  const related = e.relatedTarget as Node | null;
  if (!related || !el.contains(related)) hoverTarget.value = null;
}

function isFree(x: number, y: number, w: number, h: number, excludeId: string): boolean {
  for (const p of layout.value.items) {
    if (p.it.id === excludeId) continue;
    if (x < p.x + p.it.w && x + w > p.x && y < p.y + p.it.h && y + h > p.y) return false;
  }
  return true;
}

const hoverStyle = computed(() => {
  const t = hoverTarget.value;
  if (!t) return {};
  return {
    left: t.x * (CELL + GAP) + PAD + 'px',
    top: t.y * (CELL + GAP) + PAD + 'px',
    width: t.w * (CELL + GAP) - GAP + 'px',
    height: t.h * (CELL + GAP) - GAP + 'px',
  };
});

async function onDrop(): Promise<void> {
  const item = draggedItem();
  const t = hoverTarget.value;
  if (!item || !t) return;
  if (!t.ok) {
    game.pushToast('Место занято другим предметом', 'error');
    onDragEnd();
    return;
  }
  try {
    await post('/api/items/move', { itemId: item.it.id, x: t.x, y: t.y });
    profile.value = await auth.fetchMe();
  } catch (e) {
    game.pushToast((e as Error).message, 'error');
    profile.value = await auth.fetchMe();
  }
  onDragEnd();
}

async function autoSort(): Promise<void> {
  try {
    await post('/api/items/sort');
    game.pushToast('Инвентарь отсортирован');
    profile.value = await auth.fetchMe();
  } catch (e) {
    game.pushToast((e as Error).message, 'error');
  }
}

// ---------- контекстное меню предмета ----------

const ctxMenu = ref<{ x: number; y: number; it: InventoryRow } | null>(null);
const listItem = ref<InventoryRow | null>(null);
const listPrice = ref(0);

function openMenu(e: MouseEvent, it: InventoryRow): void {
  const MENU_W = 240;
  const MENU_H = 180;
  ctxMenu.value = {
    x: Math.min(e.clientX, window.innerWidth - MENU_W - 8),
    y: Math.min(e.clientY, window.innerHeight - MENU_H - 8),
    it,
  };
}

function closeMenu(): void {
  ctxMenu.value = null;
}

function openListDialog(): void {
  const it = ctxMenu.value?.it;
  if (!it) return;
  closeMenu();
  listPrice.value = it.value;
  listItem.value = it;
}

async function confirmList(): Promise<void> {
  const it = listItem.value;
  if (!it || !listPrice.value || listPrice.value < 1) return;
  try {
    await post('/api/market/list', { itemId: it.id, price: Math.floor(listPrice.value) });
    listItem.value = null;
    game.pushToast('«' + it.name + '» выставлен на барахолку');
    profile.value = await auth.fetchMe();
  } catch (err) {
    game.pushToast((err as Error).message, 'error');
  }
}

async function sellItem(): Promise<void> {
  const it = ctxMenu.value?.it;
  if (!it) return;
  closeMenu();
  try {
    const res = await post<{ ok: boolean; value?: number }>('/api/items/sell', { itemId: it.id });
    game.pushToast('Продано торговцу за ' + fmt(res.value ?? it.value));
    profile.value = await auth.fetchMe();
  } catch (err) {
    game.pushToast((err as Error).message, 'error');
  }
}

// ---------- продать всё ----------

const sellAllOpen = ref(false);
const sellAllBusy = ref(false);

async function sellAll(): Promise<void> {
  if (sellAllBusy.value || inventory.value.length === 0) return;
  sellAllBusy.value = true;
  try {
    const res = await post<{ ok: boolean; value?: number; count?: number }>('/api/items/sell-all');
    game.pushToast('Продано предметов: ' + (res.count ?? 0) + ' шт. за ' + fmt(res.value ?? 0));
    sellAllOpen.value = false;
    profile.value = await auth.fetchMe();
  } catch (err) {
    game.pushToast((err as Error).message, 'error');
  }
  sellAllBusy.value = false;
}

onMounted(async () => {
  try {
    profile.value = await auth.fetchMe();
  } catch {
    /* guard отправит на /login */
  }
  void loadCards();
});
</script>

<style scoped>
.inv-grid {
  position: relative;
  display: grid;
  background: #1e293b;
  border: 1px solid #334155;
  border-radius: 0.5rem;
  padding: 2px;
}
.inv-cell {
  width: 64px;
  height: 64px;
  background: #0f172a;
  border: 1px solid #1e293b;
  border-radius: 2px;
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
</style>
