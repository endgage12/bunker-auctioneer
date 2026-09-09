<script setup lang="ts">
import { DialogTitle } from 'reka-ui';
import type { DialogTitleProps } from 'reka-ui';

const props = defineProps<DialogTitleProps>();
</script>

<template>
  <DialogTitle v-bind="props" class="text-base font-semibold text-slate-100">
    <slot />
  </DialogTitle>
</template>
