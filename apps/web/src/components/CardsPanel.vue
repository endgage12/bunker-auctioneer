<template>
  <div ref="rootEl" class="panel p-4 flex flex-col gap-3">
    <div class="flex items-center justify-between">
      <h3 class="font-semibold text-sm">🃏 Особые карточки</h3>
    </div>

    <div v-if="!loaded" class="text-xs text-slate-500">Загрузка карточек…</div>

    <template v-else-if="groups.length === 0">
      <p class="text-xs text-slate-500 leading-relaxed">
        Особых карточек пока нет. Крутите колесо фортуны в
        <router-link to="/shop" class="text-amber-300 hover:underline">магазине</router-link> —
        билет стоит 1 «Пыльную вазу».
      </p>
    </template>

    <template v-else>
      <div v-for="g in groups" :key="g.setId" class="flex flex-col gap-1.5">
        <div class="text-[10px] uppercase tracking-wider text-slate-500">
          {{ g.icon }} {{ g.name }}
        </div>
        <div
          v-for="c in g.cards"
          :key="c.cardId"
          :data-card="c.cardId"
          class="rounded-lg border border-slate-700/70 bg-slate-800/40 px-2.5 py-2 flex items-center gap-2"
        >
          <div class="min-w-0 flex-1">
            <div class="text-xs font-medium truncate" :title="cardDef(c.cardId)?.desc">
              {{ cardName(c.cardId) }}
            </div>
            <div class="text-[10px] text-slate-500">×{{ c.count }}</div>
          </div>
          <button
            v-if="isAnalyzer(c.cardId)"
            class="btn-small shrink-0 px-2.5"
            :disabled="!usable || busy"
            @click="use(c.cardId)"
          >
            Применить
          </button>
          <span v-else class="text-[10px] text-slate-500 shrink-0">в инвентаре</span>
        </div>
      </div>
      <p v-if="!usable" class="text-[10px] text-slate-500">
        Анализаторы применяются во время торгов.
      </p>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { CARD_DEFS, CARD_SETS } from '@auctioneer/shared';
import { get } from '../lib/api';
import { gsap, motionOK } from '../lib/animations';
import { useGameStore } from '../stores/game';

const props = defineProps<{ phase: string }>();

interface PlayerCardGroup {
  cardId: string;
  count: number;
}

const game = useGameStore();
const cards = ref<PlayerCardGroup[]>([]);
const loaded = ref(false);
const busy = ref(false);
const rootEl = ref<HTMLElement | null>(null);

const defById = new Map(CARD_DEFS.map((d) => [d.id, d]));

function cardDef(id: string) {
  return defById.get(id);
}

function cardName(id: string): string {
  return defById.get(id)?.name ?? id;
}

function isAnalyzer(id: string): boolean {
  return defById.get(id)?.setId === 'analyzers';
}

const usable = computed(() => props.phase === 'auction');

const groups = computed(() => {
  const out: { setId: string; name: string; icon: string; cards: PlayerCardGroup[] }[] = [];
  for (const set of CARD_SETS) {
    const owned = cards.value.filter((c) => defById.get(c.cardId)?.setId === set.id);
    if (owned.length > 0) out.push({ setId: set.id, name: set.name, icon: set.icon, cards: owned });
  }
  return out;
});

async function load(): Promise<void> {
  try {
    cards.value = await get<PlayerCardGroup[]>('/api/cards');
  } catch {
    /* игнорируем: панель покажет пустоту */
  }
  loaded.value = true;
}

async function use(cardId: string): Promise<void> {
  if (busy.value || !usable.value) return;
  busy.value = true;
  try {
    const resp = await game.useCard(cardId);
    if (resp?.ok) {
      // карточка-анализатор «раскрывается» на панели: вспышка перед обновлением
      if (motionOK) {
        const row = rootEl.value?.querySelector('[data-card="' + cardId + '"]');
        if (row) {
          gsap.fromTo(
            row,
            { scale: 1 },
            { scale: 1.04, duration: 0.2, yoyo: true, repeat: 1, ease: 'power2.inOut' },
          );
          gsap.fromTo(
            row,
            { boxShadow: '0 0 0 0 rgba(167,139,250,0)' },
            { boxShadow: '0 0 22px 2px rgba(167,139,250,0.65)', duration: 0.45, yoyo: true, repeat: 1 },
          );
        }
      }
      game.pushToast('Карточка применена — редкость скрытых предметов подсвечена на столе');
      await load();
      animateCards();
    } else {
      game.pushToast(resp?.error ?? 'Не удалось применить карточку', 'error');
    }
  } catch {
    game.pushToast('Не удалось применить карточку', 'error');
  }
  busy.value = false;
}

/** Каскадное появление карточек при загрузке */
function animateCards(): void {
  if (!motionOK || !rootEl.value) return;
  const rows = rootEl.value.querySelectorAll('[data-card]');
  if (rows.length === 0) return;
  gsap.from(rows, { y: 8, opacity: 0, duration: 0.28, stagger: 0.04, ease: 'power2.out' });
}

onMounted(() => {
  void load();
  void Promise.resolve().then(animateCards);
});
</script>
