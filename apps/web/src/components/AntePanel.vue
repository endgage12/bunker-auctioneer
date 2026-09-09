<template>
  <div class="panel p-5 flex flex-col gap-3">
    <h3 class="font-semibold text-sm">Вступительная ставка</h3>
    <p class="text-xs text-slate-500">
      От {{ fmt(ANTE_MIN) }} до {{ fmt(ANTE_MAX) }}. Стол заполнится призами на 120% от банка ставок.
    </p>
    <template v-if="myPlayer && myPlayer.ante === 0">
      <div class="flex items-center gap-2">
        <input
          v-model.number="amount"
          type="number"
          inputmode="decimal"
          enterkeyhint="done"
          :min="ANTE_MIN"
          :max="Math.min(ANTE_MAX, myPlayer.cash)"
          class="input-dark font-mono"
          placeholder="Сумма ставки"
        />
        <button class="btn-small shrink-0" @click="amount = Math.min(ANTE_MAX, myPlayer.cash)">MAX</button>
      </div>
      <div class="grid grid-cols-4 gap-1">
        <button v-for="preset in presets" :key="preset" class="btn-small" @click="amount = preset">
          {{ fmt(preset) }}
        </button>
      </div>
      <button class="btn-primary w-full" :disabled="!amount || amount < 1" @click="submit">
        Поставить
      </button>
    </template>
    <div v-else class="text-sm text-slate-300">
      Ваша ставка: <b class="text-amber-300 font-mono">{{ fmt(myPlayer?.ante ?? 0) }}</b>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { ANTE_MAX, ANTE_MIN, fmt } from '@auctioneer/shared';
import type { PublicGame } from '@auctioneer/shared';

const props = defineProps<{ game: PublicGame; meId: string }>();
const emit = defineEmits<{ (e: 'ante', amount: number): void }>();

const amount = ref(ANTE_MIN);

const myPlayer = computed(() => props.game.players.find((p) => p.id === props.meId) ?? null);
const presets = computed(() => [ANTE_MIN, 25_000, 50_000, ANTE_MAX]);

function submit(): void {
  const cash = myPlayer.value?.cash ?? 0;
  const value = Math.max(1, Math.min(cash, ANTE_MAX, Math.floor(amount.value || 0)));
  emit('ante', value);
}
</script>
