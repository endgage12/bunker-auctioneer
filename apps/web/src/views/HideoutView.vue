<template>
  <div ref="rootEl" class="min-h-screen">
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
import { gsap, motionOK, shake } from '../lib/animations';
import SetCard from '../components/SetCard.vue';

const auth = useAuthStore();
const game = useGameStore();

const hideout = ref<HideoutState | null>(null);
const profile = ref<Profile | null>(null);
const rootEl = ref<HTMLElement | null>(null);

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
    await refresh();
    // предмет «встаёт» в витрину с подсветкой активации сета
    if (motionOK) {
      const card = rootEl.value?.querySelector('[data-set="' + setId + '"]');
      const slot = card?.querySelector('.set-slot-filled');
      if (slot) {
        gsap.fromTo(
          slot,
          { scale: 0.6, opacity: 0 },
          { scale: 1, opacity: 1, duration: 0.4, ease: 'back.out(2)' },
        );
      }
      if (card) {
        gsap.fromTo(
          card,
          { boxShadow: '0 0 0 0 rgba(52,211,153,0)' },
          { boxShadow: '0 0 26px 3px rgba(52,211,153,0.5)', duration: 0.4, yoyo: true, repeat: 1 },
        );
      }
    }
    game.pushToast('Предмет поставлен в витрину');
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
    await refresh();
    // Алхимия: вспышка по карточкам сетов и «вылет» полученного предмета
    if (motionOK) {
      const cards = rootEl.value?.querySelectorAll('.panel') ?? [];
      if (cards.length) {
        gsap.fromTo(
          cards,
          { filter: 'brightness(1)' },
          { filter: 'brightness(1.5)', duration: 0.25, yoyo: true, repeat: 2, stagger: 0.05 },
        );
      }
      const fresh = rootEl.value?.querySelector('[data-fresh-item]');
      if (fresh) {
        gsap.fromTo(
          fresh,
          { scale: 0.5, opacity: 0, rotate: -12 },
          { scale: 1, opacity: 1, rotate: 0, duration: 0.55, ease: 'back.out(2)' },
        );
      }
    }
    game.pushToast('Трансмутация: получен предмет «' + r.item.name + '»');
  } catch (e) {
    game.pushToast((e as Error).message, 'error');
    if (motionOK && rootEl.value) shake(rootEl.value);
  }
}
</script>
