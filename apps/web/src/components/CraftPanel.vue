<template>
  <div ref="rootEl" class="panel p-5 flex flex-col gap-3">
    <div class="flex items-start justify-between gap-2">
      <div>
        <h3 class="font-semibold flex items-center gap-2">🏺 Мастерская</h3>
        <p class="text-xs text-slate-400 mt-1 leading-relaxed">
          Три предмета <b class="text-slate-300">одного качества</b> обмениваются на
          «{{ ticketName }}» — билет колеса фортуны. Билет крутит колесо в магазине
          и приносит особую карточку.
        </p>
      </div>
    </div>

    <div v-if="loading" class="text-xs text-slate-500">Считаем материалы…</div>

    <div v-else class="flex flex-col gap-2">
      <div
        v-for="opt in options"
        :key="opt.rarity"
        :data-craft-row="opt.rarity"
        class="flex items-center gap-2 rounded-lg px-2.5 py-2"
        :class="opt.ready ? 'bg-slate-800/60' : 'bg-slate-800/25'"
      >
        <span
          class="w-2.5 h-2.5 rounded-full shrink-0"
          :style="{ background: RARITY_HEX[opt.rarity] }"
          aria-hidden="true"
        ></span>
        <div class="min-w-0 flex-1">
          <div class="text-xs" :class="opt.ready ? 'text-slate-200' : 'text-slate-500'">
            {{ RARITY_LABEL[opt.rarity] }}
          </div>
          <!-- сколько набрано из нужных трёх: видно, чего не хватает -->
          <div class="flex gap-0.5 mt-1">
            <span
              v-for="i in perRecipe"
              :key="i"
              class="h-1.5 w-5 rounded-full"
              :class="i <= Math.min(opt.available, perRecipe) ? 'bg-emerald-400/80' : 'bg-slate-700'"
            ></span>
          </div>
        </div>
        <span class="text-[10px] font-mono shrink-0" :class="opt.ready ? 'text-emerald-300' : 'text-slate-500'">
          {{ Math.min(opt.available, perRecipe) }}/{{ perRecipe }}
        </span>
        <button
          class="btn-small shrink-0"
          :disabled="!opt.ready || busy === opt.rarity"
          :title="opt.ready ? 'Обменять три предмета на билет' : 'Не хватает предметов этого качества'"
          @click="craft(opt.rarity)"
        >
          {{ busy === opt.rarity ? '…' : 'Обменять' }}
        </button>
      </div>
    </div>

    <p class="text-[10px] text-slate-500 leading-relaxed">
      В обмен идут три самых дешёвых предмета выбранного качества; готовые билеты
      в обмен не попадают. Карточки можно продать и купить на барахолке.
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { CRAFT_ITEMS_PER_RECIPE, RARITY_LABEL, WHEEL_TICKET_NAME } from '@auctioneer/shared';
import type { Rarity } from '@auctioneer/shared';
import { get, post } from '../lib/api';
import { useGameStore } from '../stores/game';
import { gsap, motionOK } from '../lib/animations';
import { RARITY_HEX } from '../lib/rarity';

interface CraftOption {
  rarity: Rarity;
  available: number;
  ready: boolean;
}

const emit = defineEmits<{ (e: 'crafted'): void }>();

const game = useGameStore();
const rootEl = ref<HTMLElement | null>(null);
const options = ref<CraftOption[]>([]);
const loading = ref(true);
const busy = ref<Rarity | null>(null);

const perRecipe = computed(() => CRAFT_ITEMS_PER_RECIPE);
const ticketName = WHEEL_TICKET_NAME;

async function load(): Promise<void> {
  try {
    const data = await get<{ options?: CraftOption[] }>('/api/craft');
    options.value = data.options ?? [];
  } catch {
    options.value = [];
  } finally {
    loading.value = false;
  }
}

async function craft(rarity: Rarity): Promise<void> {
  if (busy.value) return;
  busy.value = rarity;
  try {
    await post('/api/craft/vase', { rarity });
    await load();
    // вспышка по строке рецепта: обмен состоялся
    if (motionOK && rootEl.value) {
      const row = rootEl.value.querySelector('[data-craft-row="' + rarity + '"]');
      if (row) {
        gsap.fromTo(
          row,
          { scale: 1 },
          { scale: 1.03, duration: 0.2, yoyo: true, repeat: 1, ease: 'power2.inOut' },
        );
        gsap.fromTo(
          row,
          { boxShadow: '0 0 0 0 rgba(52,211,153,0)' },
          { boxShadow: '0 0 20px 2px rgba(52,211,153,0.6)', duration: 0.4, yoyo: true, repeat: 1 },
        );
      }
    }
    game.pushToast('Получена «' + ticketName + '» — билет колеса фортуны');
    emit('crafted');
  } catch (e) {
    game.pushToast((e as Error).message, 'error');
    await load();
  } finally {
    busy.value = null;
  }
}

onMounted(() => {
  void load();
});

defineExpose({ reload: load });
</script>
