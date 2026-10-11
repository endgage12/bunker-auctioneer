<template>
  <div ref="rootEl" class="min-h-screen">
    <TopNav />
    <div class="max-w-6xl mx-auto p-6 grid grid-cols-1 lg:grid-cols-5 gap-6 items-start">
      <!-- Мой инвентарь -->
      <div class="lg:col-span-2 flex flex-col gap-6">
        <div class="panel p-5">
          <div class="flex items-center justify-between mb-1">
            <h2 class="font-semibold">Мой инвентарь</h2>
            <span class="text-xs text-slate-400">
              {{ inventory.length }} предм. ·
              <span class="text-amber-300 font-mono"><CoinAmount :value="inventoryValue" /></span>
            </span>
          </div>
          <p class="text-xs text-slate-500 mb-4">
            Номинал предмета — цена мгновенной продажи торговцу.
            На барахолке можно выставить любую цену (комиссия дома 5%).
          </p>
          <div v-if="inventory.length === 0" class="text-sm text-slate-500">Инвентарь пуст</div>
          <div class="flex flex-wrap gap-2">
            <div
              v-for="it in inventory"
              :key="it.id"
              class="w-24 h-24 rounded-lg overflow-hidden cursor-pointer transition ring-2 ring-transparent hover:ring-slate-500"
              :title="it.name + ' ' + it.w + 'x' + it.h + ' — номинал ' + fmt(it.value)"
              @click="openItem(it)"
            >
              <ItemCard :name="it.name" :rarity="it.rarity" :value="it.value" :def-id="it.defId" dense :click-details="false" />
            </div>
          </div>
        </div>

        <!-- Мои лоты -->
        <div class="panel p-5">
          <h2 class="font-semibold mb-3">Мои лоты ({{ myListings.length }})</h2>
          <div v-if="myListings.length === 0" class="text-sm text-slate-500">Вы ничего не выставили</div>
          <div v-else class="flex flex-col gap-2">
            <div v-for="l in myListings" :key="l.id" class="flex items-center gap-3 px-2 py-1.5 rounded-lg bg-slate-800/40">
              <div class="w-12 h-12 rounded overflow-hidden shrink-0">
                <ItemCard :name="l.item.name" :rarity="l.item.rarity" :def-id="l.item.defId" dense :show-value="false" :click-details="false" />
              </div>
              <div class="min-w-0 flex-1">
                <div class="text-sm truncate">{{ l.item.name }}</div>
                <div class="text-xs text-slate-400">
                  цена: <span class="text-amber-300 font-mono"><CoinAmount :value="l.price" /></span> · истекает {{ expires(l) }}
                </div>
              </div>
              <button class="btn-small" @click="cancelLot(l.id)">Снять</button>
            </div>
          </div>
        </div>

        <!-- История операций -->
        <div class="panel p-5">
          <h2 class="font-semibold mb-3">История операций</h2>
          <div v-if="history.length === 0" class="text-sm text-slate-500">
            Пока пусто — покупайте и продавайте на барахолке
          </div>
          <div v-else class="flex flex-col gap-2 max-h-72 overflow-y-auto pr-1">
            <div v-for="h in history" :key="h.id" class="flex items-center gap-3 px-2 py-1.5 rounded-lg bg-slate-800/40">
              <span class="text-[10px] px-1.5 py-0.5 rounded font-semibold shrink-0" :class="historyKindClass(h.kind)">
                {{ historyKindLabel(h.kind) }}
              </span>
              <div class="min-w-0 flex-1">
                <div class="text-sm truncate" :style="{ color: RARITY_HEX[h.rarity] }">{{ h.itemName }}</div>
                <div class="text-[11px] text-slate-500 truncate">{{ counterpartText(h) }}</div>
              </div>
              <div class="text-right shrink-0">
                <div class="text-xs font-mono" :class="h.kind === 'buy' ? 'text-rose-300' : 'text-emerald-300'">
                  <CoinAmount :value="h.price" :sign="h.kind === 'buy' ? '−' : '+'" />
                </div>
                <div v-if="h.kind === 'sell' && h.fee > 0" class="text-[10px] text-slate-500">комиссия <CoinAmount :value="h.fee" sign="−" /></div>
                <div class="text-[10px] text-slate-500">{{ fmtTime(h.at) }}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Барахолка -->
      <div class="lg:col-span-3 panel p-5">
        <div class="flex items-center justify-between mb-4">
          <h2 class="font-semibold">Барахолка</h2>
          <span class="text-xs text-slate-400">лотов: {{ filteredListings.length }}</span>
        </div>
        <div class="flex flex-col sm:flex-row gap-3 mb-4">
          <input v-model="search" class="input-dark sm:max-w-xs" placeholder="Поиск по названию или продавцу…" />
          <div class="flex flex-wrap gap-1 items-center">
            <button
              v-for="r in RARITY_ORDER"
              :key="r"
              class="text-[11px] px-2 py-1 rounded-full border transition"
              :style="rarityChip(r)"
              @click="toggleRarity(r)"
            >
              {{ RARITY_LABEL[r] }}
            </button>
          </div>
        </div>
        <div v-if="filteredListings.length === 0" class="text-sm text-slate-500">Лотов не найдено</div>
        <div class="flex flex-col gap-2 max-h-[62vh] overflow-y-auto pr-1">
          <div
            v-for="l in filteredListings"
            :key="l.id"
            :data-lot-row="l.id"
            :data-lot="l.id"
            class="flex items-center gap-3 px-2 py-2 rounded-lg bg-slate-800/40"
          >
            <div class="w-14 h-14 rounded overflow-hidden shrink-0">
              <ItemCard :name="l.item.name" :rarity="l.item.rarity" :value="l.item.value" :def-id="l.item.defId" dense :click-details="false" />
            </div>
            <div class="min-w-0 flex-1">
              <div class="text-sm truncate">
                {{ l.item.name }}
                <span class="text-slate-500 text-xs">{{ l.item.w }}×{{ l.item.h }}</span>
                <span
                  v-if="setNeedBadge(l)"
                  class="text-[9px] px-1 ml-1 rounded bg-violet-500/20 text-violet-300"
                >
                  для сета «{{ setNeedBadge(l) }}»
                </span>
              </div>
              <div class="text-xs text-slate-400">
                продавец: {{ l.sellerName }}
                <span class="text-slate-600">· номинал <CoinAmount :value="l.item.value" /></span>
              </div>
            </div>
            <div class="text-right shrink-0">
              <div class="font-mono text-amber-300"><CoinAmount :value="l.price" /></div>
              <span v-if="l.mine" class="text-[11px] text-slate-500">ваш лот</span>
              <span v-else-if="profile && l.price > profile.cash" class="text-[11px] text-slate-500">
                не хватает средств
              </span>
              <button v-else class="btn-small px-3" @click="buyLot(l.id)">Купить</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- модалка действий с предметом -->
    <Dialog v-model:open="dialogOpen">
      <DialogContent>
        <template v-if="modalItem">
          <DialogHeader class="pr-8">
            <DialogTitle>{{ modalItem.name }}</DialogTitle>
          </DialogHeader>
          <div class="mt-3 flex items-center gap-3">
            <div class="w-16 h-16 rounded-lg overflow-hidden shrink-0">
              <ItemCard :name="modalItem.name" :rarity="modalItem.rarity" :value="modalItem.value" :def-id="modalItem.defId" dense :click-details="false" />
            </div>
            <div class="text-sm text-slate-400 min-w-0">
              <div class="flex items-center gap-2">
                <span class="inline-block h-2.5 w-2.5 rounded-full shrink-0" :style="{ background: RARITY_HEX[modalItem.rarity] }"></span>
                <span>{{ RARITY_LABEL[modalItem.rarity] }}</span>
              </div>
              <div class="mt-1">
                размер {{ modalItem.w }}×{{ modalItem.h }} · номинал
                <span class="text-amber-300 font-mono"><CoinAmount :value="modalItem.value" /></span>
              </div>
            </div>
          </div>

          <button class="btn-ghost w-full mt-4" @click="sellToVendor(modalItem.id)">
            Продать торговцу за <CoinAmount :value="modalItem.value" />
          </button>

          <div class="h-px bg-slate-800 my-4"></div>

          <div class="flex gap-2">
            <input
              v-model.number="price"
              type="number"
              min="1"
              class="input-dark"
              placeholder="Цена"
              @keyup.enter="listItem(modalItem.id)"
            />
            <button
              class="btn-primary shrink-0"
              :disabled="!price || price < 1"
              @click="listItem(modalItem.id)"
            >
              Выставить на барахолку
            </button>
          </div>
          <p class="text-xs text-slate-500 mt-2">Комиссия дома с продажи — 5%</p>
        </template>
      </DialogContent>
    </Dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { fmt, RARITY_LABEL, RARITY_ORDER } from '@auctioneer/shared';
import type { HideoutState, InventoryRow, MarketHistoryEntry, MarketListing, Profile, Rarity } from '@auctioneer/shared';
import { get, post } from '../lib/api';
import { useAuthStore } from '../stores/auth';
import { useGameStore } from '../stores/game';
import { RARITY_HEX } from '../lib/rarity';
import TopNav from '../components/TopNav.vue';
import { gsap, motionOK, staggerIn } from '../lib/animations';
import ItemCard from '../components/ItemCard.vue';
import CoinAmount from '../components/CoinAmount.vue';
import Dialog from '../components/ui/dialog/Dialog.vue';
import DialogContent from '../components/ui/dialog/DialogContent.vue';
import DialogHeader from '../components/ui/dialog/DialogHeader.vue';
import DialogTitle from '../components/ui/dialog/DialogTitle.vue';

const auth = useAuthStore();
const game = useGameStore();

const profile = ref<Profile | null>(null);
const listings = ref<MarketListing[]>([]);
/** корневой узел: нужен как область для анимаций */
const rootEl = ref<HTMLElement | null>(null);
const hideout = ref<HideoutState | null>(null);
const history = ref<MarketHistoryEntry[]>([]);
const dialogOpen = ref(false);
const modalItem = ref<InventoryRow | null>(null);
const price = ref(0);
const search = ref('');
const rarityFilter = ref<Rarity | null>(null);

const inventory = computed(() => profile.value?.inventory ?? []);
const inventoryValue = computed(() => inventory.value.reduce((s, i) => s + i.value, 0));
const myListings = computed(() => listings.value.filter((l) => l.mine));
const filteredListings = computed(() => {
  const q = search.value.trim().toLowerCase();
  return listings.value.filter((l) => {
    if (rarityFilter.value && l.item.rarity !== rarityFilter.value) return false;
    if (q && !l.item.name.toLowerCase().includes(q) && !l.sellerName.toLowerCase().includes(q)) return false;
    return true;
  });
});

onMounted(async () => {
  await refresh();
});

async function refresh(): Promise<void> {
  try {
    profile.value = await auth.fetchMe();
    listings.value = await get<MarketListing[]>('/api/market');
    hideout.value = await get<HideoutState>('/api/hideout');
    history.value = await get<MarketHistoryEntry[]>('/api/market/history');
  } catch (e) {
    game.pushToast((e as Error).message, 'error');
  }
}

/** Нужен ли этот предмет для одного из моих недособранных сетов */
function setNeedBadge(l: MarketListing): string | null {
  if (!hideout.value) return null;
  for (const set of hideout.value.sets) {
    if (set.active) continue;
    const slot = set.slots.find((s) => s.defId === l.item.defId);
    if (slot && !slot.placed) return set.name;
  }
  return null;
}

function openItem(it: InventoryRow): void {
  modalItem.value = it;
  price.value = it.value;
  dialogOpen.value = true;
}

async function sellToVendor(itemId: string): Promise<void> {
  try {
    const r = await post<{ ok: boolean; value: number }>('/api/items/sell', { itemId });
    game.pushToast('Продано торговцу за ' + fmt(r.value));
    dialogOpen.value = false;
    await refresh();
  } catch (e) {
    game.pushToast((e as Error).message, 'error');
  }
}

async function listItem(itemId: string): Promise<void> {
  if (!price.value || price.value < 1) return;
  try {
    await post('/api/market/list', { itemId, price: Math.floor(price.value) });
    game.pushToast('Предмет выставлен на барахолку');
    dialogOpen.value = false;
    price.value = 0;
    await refresh();
  } catch (e) {
    game.pushToast((e as Error).message, 'error');
  }
}

/** Каскадное появление списка лотов при обновлении */
function animateRows(): void {
  if (!motionOK) return;
  const rows = rootEl.value?.querySelectorAll('[data-lot-row]');
  if (!rows || rows.length === 0) return;
  staggerIn(rows, { stagger: 0.025, y: 10, duration: 0.28 });
}

async function buyLot(listingId: string): Promise<void> {
  try {
    // лот «улетает» влево — в сторону блока инвентаря
    if (motionOK) {
      const row = rootEl.value?.querySelector('[data-lot="' + listingId + '"]');
      if (row) {
        await new Promise<void>((resolve) => {
          gsap.to(row, { x: -40, opacity: 0, scale: 0.9, duration: 0.3, ease: 'power2.in', onComplete: () => resolve() });
        });
      }
    }
    await post('/api/market/buy', { listingId });
    await refresh();
    animateRows();
    game.pushToast('Покупка совершена — предмет в инвентаре');
  } catch (e) {
    game.pushToast((e as Error).message, 'error');
  }
}

async function cancelLot(listingId: string): Promise<void> {
  try {
    await post('/api/market/cancel', { listingId });
    await refresh();
    animateRows();
    game.pushToast('Лот снят — предмет возвращён в инвентарь');
  } catch (e) {
    game.pushToast((e as Error).message, 'error');
  }
}

function toggleRarity(r: Rarity): void {
  rarityFilter.value = rarityFilter.value === r ? null : r;
}

function rarityChip(r: Rarity): Record<string, string> {
  const c = RARITY_HEX[r];
  const active = rarityFilter.value === r;
  return {
    borderColor: c,
    color: active ? '#020617' : c,
    background: active ? c : c + '14',
  };
}

function expires(l: MarketListing): string {
  const days = Math.max(0, Math.ceil((l.expiresAt - Date.now()) / 86400000));
  return days + ' дн.';
}

function historyKindLabel(kind: MarketHistoryEntry['kind']): string {
  if (kind === 'buy') return 'Куплено';
  if (kind === 'sell') return 'Продано';
  return 'Торговцу';
}

function historyKindClass(kind: MarketHistoryEntry['kind']): string {
  if (kind === 'buy') return 'bg-emerald-500/20 text-emerald-300';
  if (kind === 'sell') return 'bg-sky-500/20 text-sky-300';
  return 'bg-amber-500/20 text-amber-300';
}

function counterpartText(h: MarketHistoryEntry): string {
  if (h.kind === 'buy') return 'у ' + h.counterpart;
  if (h.kind === 'sell') return 'для ' + h.counterpart;
  return 'продажа торговцу';
}

function fmtTime(at: number): string {
  return new Date(at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}
</script>
