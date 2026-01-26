<template>
  <section class="block">
    <button class="button" :disabled="disabled || loading" @click="$emit('process')">
      {{ loading ? "Обработка..." : "2. Обработать и скачать ZIP" }}
    </button>

    <LogPanel :entries="entries" @clear="$emit('clear')" />
  </section>
</template>

<script setup>
import LogPanel from "@/components/LogPanel.vue";

defineProps({
  disabled: { type: Boolean, default: false },
  loading: { type: Boolean, default: false },
  entries: { type: Array, default: () => [] },
});

defineEmits(["process", "clear"]);
</script>
<style scoped>
.block {
  margin-bottom: 18px;
  padding: 16px 18px;
  border-radius: var(--hl-radius);
  background: var(--hl-surface-2);
  border: 1px solid var(--hl-border);
  box-shadow: var(--hl-shadow-sm);
}

button {
  display: inline-flex;
  align-items: center;
  justify-content: center;

  min-width: 280px;
  height: 44px;
  padding: 0 18px;

  border-radius: 12px;
  border: 1px solid rgba(37, 99, 235, 0.35);

  background: var(--hl-primary);
  color: #fff;

  font-size: 14px;
  font-weight: 650;
  letter-spacing: 0.01em;

  cursor: pointer;
  transition: background 0.15s ease, transform 0.08s ease, box-shadow 0.15s ease;
  box-shadow: 0 10px 20px rgba(37, 99, 235, 0.18);
}

button:hover:not([disabled]) {
  background: var(--hl-primary-hover);
}

button:active:not([disabled]) {
  background: var(--hl-primary-pressed);
  transform: translateY(1px);
}

button:focus-visible {
  outline: none;
  box-shadow:
    0 10px 20px rgba(37, 99, 235, 0.18),
    0 0 0 4px var(--hl-focus);
}

button[disabled] {
  opacity: 0.55;
  cursor: not-allowed;
  background: rgba(15, 23, 42, 0.08);
  border-color: rgba(15, 23, 42, 0.12);
  box-shadow: none;
}
</style>
