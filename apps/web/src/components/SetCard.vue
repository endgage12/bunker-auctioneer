<template>
  <div :data-set="set.setId" class="panel p-5 flex flex-col gap-3" :class="set.active ? 'ring-2 ring-amber-400/60' : ''">
    <div class="flex items-start justify-between gap-2">
      <div>
        <h3 class="font-semibold">{{ set.name }}</h3>
        <div class="text-xs text-slate-500 italic">{{ set.subtitle }}</div>
      </div>
      <span
        v-if="set.active"
        class="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 shrink-0"
      >
        АКТИВЕН
      </span>
    </div>
    <p class="text-xs text-slate-400 italic">«{{ set.lore }}»</p>
    <div class="text-xs text-slate-300">
      <b class="text-amber-200">{{ set.bonusTitle }}</b>: {{ set.bonusText }}
    </div>
    <div v-if="!set.live" class="text-[10px] text-slate-500">часть бонуса появится с новыми механиками</div>

    <!-- слоты витрины -->
    <div class="flex flex-wrap gap-2 mt-1">
      <div
        v-for="slot in set.slots"
        :key="slot.defId"
        class="w-20 h-24 rounded-lg border border-dashed flex flex-col overflow-hidden"
        :class="slot.placed ? 'set-slot-on border-amber-400/50 bg-slate-800/40' : 'border-slate-600'"
      >
        <div v-if="slot.placed" class="set-slot-filled flex-1 min-h-0">
          <ItemCard :name="slot.name" :rarity="slot.rarity" :def-id="slot.defId" dense :show-value="false" />
          <button class="text-[9px] text-rose-300 hover:text-rose-200 w-full" @click="$emit('remove', slot.itemId)">
            убрать
          </button>
        </div>
        <button
          v-else
          class="flex-1 text-[9px] text-slate-500 hover:text-slate-300 flex items-center justify-center p-1 text-center"
          @click="togglePicker(slot.defId)"
        >
          {{ pickerOpen === slot.defId ? 'закрыть' : slot.name }}
        </button>
      </div>
    </div>

    <!-- выбор предмета для слота -->
    <div v-if="pickerOpen" class="flex flex-wrap gap-2 rounded-lg bg-slate-800/50 p-2">
      <div v-if="candidates.length === 0" class="text-xs text-slate-500">
        Нет подходящего предмета в инвентаре — поищите на барахолке
      </div>
      <button
        v-for="it in candidates"
        :key="it.id"
        class="w-16 h-16 rounded overflow-hidden ring-1 ring-slate-600 hover:ring-amber-400 transition"
        :title="it.name + ' — ' + fmt(it.value)"
        @click="place(it.id)"
      >
        <ItemCard :name="it.name" :rarity="it.rarity" :value="it.value" :def-id="it.defId" dense />
      </button>
    </div>

    <div class="text-[11px] text-slate-500">Собрано {{ set.placedCount }}/{{ set.slots.length }}</div>

    <!-- трансмутация алхимика -->
    <div v-if="set.setId === 'alchemist' && set.active" class="border-t border-slate-800 pt-3">
      <button class="btn-primary w-full" :disabled="!transmuteReady" @click="$emit('transmute')">
        Трансмутация: 3 белых → зелёный+
      </button>
      <div class="text-[10px] text-slate-500 mt-1">{{ transmuteHint }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { fmt } from '@auctioneer/shared';
import type { InventoryRow, SetProgress } from '@auctioneer/shared';
import ItemCard from './ItemCard.vue';

const props = defineProps<{
  set: SetProgress;
  inventory: InventoryRow[];
  transmuteReady: boolean;
  transmuteHint: string;
}>();

const emit = defineEmits<{
  (e: 'place', setId: string, itemId: string): void;
  (e: 'remove', itemId: string | undefined): void;
  (e: 'transmute'): void;
}>();

const pickerOpen = ref<string | null>(null);

function togglePicker(defId: string): void {
  pickerOpen.value = pickerOpen.value === defId ? null : defId;
}

const candidates = computed(() =>
  pickerOpen.value ? props.inventory.filter((i) => i.defId === pickerOpen.value) : [],
);

function place(itemId: string): void {
  emit('place', props.set.setId, itemId);
  pickerOpen.value = null;
}
</script>
