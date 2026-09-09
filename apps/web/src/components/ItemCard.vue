<template>
  <Popover v-model:open="open">
    <PopoverTrigger as-child>
      <div
        class="item-card-inner"
        :class="dense ? 'dense' : ''"
        :style="cardStyle"
        @mouseenter="open = hoverable"
        @mouseleave="open = false"
        @focusin="open = true"
        @focusout="open = false"
      >
        <img
          v-if="iconUrl"
          :src="iconUrl"
          alt=""
          draggable="false"
          class="item-icon select-none"
        />
        <div class="truncate w-full text-center shrink-0" :class="dense ? 'text-[9px] leading-tight' : 'text-xs'">
          {{ name }}
        </div>
        <div v-if="showValue && value !== undefined" class="font-semibold shrink-0" :class="dense ? 'text-[9px]' : 'text-sm'">
          <CoinAmount :value="value" />
        </div>
        <div v-if="!dense && w && h" class="text-[10px] opacity-80 shrink-0">{{ w }}×{{ h }}</div>
      </div>
    </PopoverTrigger>

    <PopoverContent class="w-60">
      <div class="flex items-center gap-2 mb-1.5">
        <span class="inline-block h-2.5 w-2.5 rounded-full shrink-0" :style="{ background: rarityColor }"></span>
        <span class="text-xs text-slate-400">{{ RARITY_LABEL[rarity] }}</span>
      </div>
      <div class="font-semibold text-sm leading-snug mb-2">{{ name }}</div>
      <div v-if="value !== undefined" class="text-sm mb-1">
        Стоимость: <span class="text-amber-300 font-mono"><CoinAmount :value="value" /></span>
      </div>
      <div v-if="defRange" class="text-xs text-slate-400 mb-1">
        Каталог: <CoinAmount :value="defRange.value" /> · {{ defRange.w }}×{{ defRange.h }}
      </div>
      <div v-if="w && h" class="text-xs text-slate-400">Размер: {{ w }}×{{ h }}</div>
    </PopoverContent>
  </Popover>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import type { CSSProperties } from 'vue';
import { RARITY_LABEL } from '@auctioneer/shared';
import type { Rarity } from '@auctioneer/shared';
import { RARITY_HEX } from '../lib/rarity';
import { catalogDef, itemIconUrl } from '../lib/items';
import Popover from './ui/popover/Popover.vue';
import CoinAmount from './CoinAmount.vue';
import PopoverTrigger from './ui/popover/PopoverTrigger.vue';
import PopoverContent from './ui/popover/PopoverContent.vue';

const props = withDefaults(
  defineProps<{
    name: string;
    rarity: Rarity;
    value?: number;
    w?: number;
    h?: number;
    dense?: boolean;
    showValue?: boolean;
    /** id предмета каталога (если нет — ищем иконку по имени) */
    defId?: string;
  }>(),
  { dense: false, showValue: true },
);

const open = ref(false);

/** На тач-устройствах hover-поповер не открываем: тап занят другими действиями */
const hoverable = typeof window !== 'undefined' && window.matchMedia('(hover: hover)').matches;

const iconUrl = computed(() => itemIconUrl(props.defId, props.name));
const defRange = computed(() => catalogDef(props.defId, props.name));
const rarityColor = computed(() => RARITY_HEX[props.rarity]);

const cardStyle = computed<CSSProperties>(() => {
  const c = RARITY_HEX[props.rarity];
  return {
    background: 'linear-gradient(135deg, ' + c + '2e 0%, ' + c + '14 100%)',
    borderColor: c,
    color: '#fff',
    textShadow: '0 1px 2px rgba(0,0,0,0.65)',
    border: '1px solid ' + c,
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '2px',
    borderRadius: props.dense ? '3px' : '8px',
    padding: props.dense ? '2px' : '6px',
  };
});
</script>

<style scoped>
.item-card-inner {
  overflow: hidden;
}
.item-icon {
  width: 100%;
  flex: 1 1 auto;
  min-height: 0;
  max-height: 64px;
  object-fit: contain;
  image-rendering: auto;
  pointer-events: none;
}
</style>
