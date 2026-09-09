<template>
  <div class="panel">
    <div class="flex items-center justify-between mb-2">
      <h3 class="text-sm font-semibold">Инвентарь ({{ rows.length }})</h3>
      <div class="text-xs text-slate-400">
        сумма: <span class="text-amber-300 font-mono">{{ fmt(totalValue) }}</span>
      </div>
    </div>
    <div v-if="rows.length === 0" class="text-xs text-slate-500">Нет доступных предметов</div>
    <div class="flex flex-wrap gap-2 max-h-44 overflow-y-auto">
      <div
        v-for="it in rows"
        :key="it.id"
        class="w-20 h-20 cursor-pointer rounded-lg overflow-hidden transition ring-2 shrink-0"
        :class="it.id === selectedId ? 'ring-amber-400' : 'ring-transparent hover:ring-slate-500'"
        :title="it.name + ' ' + it.w + 'x' + it.h + ' — ' + fmt(it.value)"
        @click="$emit('select', it.id)"
      >
        <ItemCard :name="it.name" :rarity="it.rarity" :value="it.value" :def-id="it.defId" dense />
      </div>
    </div>
    <div v-if="selectedItem" class="mt-3 flex items-center gap-2 text-xs">
      <span class="text-slate-300">Выбрано: {{ selectedItem.name }}</span>
      <button class="btn-small px-2" @click="$emit('rotate')">Повернуть</button>
      <span class="text-slate-500 font-mono">{{ rotated ? selectedItem.h + 'x' + selectedItem.w : selectedItem.w + 'x' + selectedItem.h }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { fmt } from '@auctioneer/shared';
import type { InventoryRow } from '@auctioneer/shared';
import ItemCard from './ItemCard.vue';

const props = defineProps<{
  rows: InventoryRow[];
  selectedId: string | null;
  rotated: boolean;
}>();

defineEmits<{
  (e: 'select', id: string): void;
  (e: 'rotate'): void;
}>();

const totalValue = computed(() => props.rows.reduce((s, i) => s + i.value, 0));
const selectedItem = computed(() => props.rows.find((i) => i.id === props.selectedId) ?? null);
</script>
