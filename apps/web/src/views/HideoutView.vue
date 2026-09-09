<template>
  <div class="min-h-screen">
    <TopNav />
    <div class="max-w-6xl mx-auto p-6">
      <div class="flex items-end justify-between mb-6">
        <div>
          <h1 class="text-xl font-bold">Сеты</h1>
          <p class="text-sm text-slate-400">
            Собирайте тематические сеты предметов в витринах — они дают постоянные бонусы.
          </p>
        </div>
        <div class="text-sm text-slate-300 text-right">
          Сетов собрано:
          <b class="text-amber-300">{{ hideout?.completedSets ?? 0 }}/{{ hideout?.totalSets ?? 9 }}</b>
          <span
            v-if="hideout?.metaActive"
            class="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300"
          >
            ВЕЛИКИЙ КОЛЛЕКЦИОНЕР
          </span>
        </div>
      </div>

      <div v-if="!hideout" class="text-slate-400">Загрузка…</div>
      <div v-else class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        <SetCard
          v-for="set in hideout.sets"
          :key="set.setId"
          :set="set"
          :inventory="inventory"
          :transmute-ready="transmuteReady"
          :transmute-hint="transmuteHint"
          @place="place"
          @remove="removeItem"
          @transmute="doTransmute"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import type { HideoutState, InventoryRow, Profile } from '@auctioneer/shared';
import { get, post } from '../lib/api';
import { useAuthStore } from '../stores/auth';
import { useGameStore } from '../stores/game';
import TopNav from '../components/TopNav.vue';
import SetCard from '../components/SetCard.vue';

const auth = useAuthStore();
const game = useGameStore();

const hideout = ref<HideoutState | null>(null);
const profile = ref<Profile | null>(null);

const inventory = computed<InventoryRow[]>(() => profile.value?.inventory ?? []);

const transmuteReady = computed(() => {
  const last = hideout.value?.lastTransmuteAt ?? 0;
  return Date.now() - last >= 24 * 60 * 60 * 1000;
});

const transmuteHint = computed(() => {
  const last = hideout.value?.lastTransmuteAt ?? 0;
  if (transmuteReady.value) return 'доступно сейчас';
  const next = new Date(last + 24 * 60 * 60 * 1000);
  return 'следующая: ' + next.toLocaleString('ru-RU');
});

onMounted(async () => {
  await refresh();
});

async function refresh(): Promise<void> {
  try {
    profile.value = await auth.fetchMe();
    hideout.value = await get<HideoutState>('/api/hideout');
  } catch (e) {
    game.pushToast((e as Error).message, 'error');
  }
}

async function place(setId: string, itemId: string): Promise<void> {
  try {
    await post('/api/hideout/place', { setId, itemId });
    game.pushToast('Предмет поставлен в витрину');
    await refresh();
  } catch (e) {
    game.pushToast((e as Error).message, 'error');
  }
}

async function removeItem(itemId: string | undefined): Promise<void> {
  if (!itemId) return;
  try {
    await post('/api/hideout/remove', { itemId });
    game.pushToast('Предмет возвращён в инвентарь');
    await refresh();
  } catch (e) {
    game.pushToast((e as Error).message, 'error');
  }
}

async function doTransmute(): Promise<void> {
  try {
    const r = await post<{ ok: boolean; item: InventoryRow }>('/api/hideout/transmute');
    game.pushToast('Трансмутация: получен предмет «' + r.item.name + '»');
    await refresh();
  } catch (e) {
    game.pushToast((e as Error).message, 'error');
  }
}
</script>
