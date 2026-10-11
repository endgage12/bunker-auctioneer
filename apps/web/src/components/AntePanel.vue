<template>
  <div class="panel p-5 flex flex-col gap-3" :class="tier?.id === 'gold' ? 'ring-1 ring-amber-500/40' : ''">
    <div class="flex items-center justify-between gap-2">
      <h3 class="font-semibold text-sm flex items-center gap-2">
        <span class="text-base">{{ tier?.icon ?? '🎲' }}</span>
        {{ tier?.name ?? 'Зал' }}
      </h3>
      <span class="text-[11px] text-slate-500">вход в партию</span>
    </div>

    <p class="text-xs text-slate-500">
      Плата за вход фиксирована залом, а ценность стола разыграна заранее — до начала торгов.
      Стол уже запечатан.
    </p>

    <div class="flex items-baseline justify-between gap-2 rounded-lg bg-slate-800/60 px-3 py-2">
      <span class="text-xs text-slate-400">Стоимость входа</span>
      <b ref="feeEl" class="font-mono text-amber-300 text-lg">
        <CoinAmount :value="entry" />
      </b>
    </div>

    <template v-if="myPlayer && myPlayer.ante === 0">
      <button ref="confirmEl" class="btn-primary w-full" :disabled="!canPay" @click="submit">
        {{ canPay ? 'Подтвердить вход' : 'Не хватает на вход' }}
      </button>
      <p v-if="!canPay" class="text-[11px] text-rose-300">
        Нужно <CoinAmount :value="entry" />, у вас <CoinAmount :value="myPlayer.cash" />.
        Продайте предметы торговцу или сыграйте в младшем зале.
      </p>
    </template>

    <div v-else class="flex items-center gap-2 text-sm text-emerald-300">
      <span>✓ Вход подтверждён</span>
      <b class="font-mono"><CoinAmount :value="myPlayer?.ante ?? 0" /></b>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import CoinAmount from './CoinAmount.vue';
import { gsap, motionOK, shake } from '../lib/animations';
import type { PublicGame } from '@auctioneer/shared';

const props = defineProps<{ game: PublicGame; meId: string }>();
const emit = defineEmits<{ (e: 'ante'): void }>();

const tier = computed(() => props.game.tier ?? null);
const entry = computed(() => tier.value?.entry ?? 0);
const myPlayer = computed(() => props.game.players.find((p) => p.id === props.meId) ?? null);
const canPay = computed(() => (myPlayer.value?.cash ?? 0) >= entry.value);

const feeEl = ref<HTMLElement | null>(null);
const confirmEl = ref<HTMLElement | null>(null);

onMounted(() => {
  if (!motionOK) return;
  // вход в зал: плата «вылетает» и подсвечивается, кнопка мягко появляется
  if (feeEl.value) {
    gsap.from(feeEl.value, { y: 8, opacity: 0, duration: 0.45, ease: 'power2.out' });
    gsap.fromTo(
      feeEl.value,
      { textShadow: '0 0 0px rgba(251,191,36,0)' },
      { textShadow: '0 0 18px rgba(251,191,36,0.55)', duration: 0.85, yoyo: true, repeat: 1 },
    );
  }
  if (confirmEl.value) {
    gsap.from(confirmEl.value, { scale: 0.96, opacity: 0, duration: 0.35, delay: 0.15, ease: 'power2.out' });
  }
});

function submit(): void {
  if (!canPay.value) {
    shake(confirmEl.value);
    return;
  }
  if (confirmEl.value && motionOK) {
    gsap.fromTo(confirmEl.value, { scale: 0.97 }, { scale: 1, duration: 0.25, ease: 'back.out(2)' });
  }
  emit('ante');
}
</script>
