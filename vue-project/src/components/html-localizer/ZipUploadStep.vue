<template>
  <section class="block">
    <h2>1. Загрузите ZIP с версткой и переводами</h2>

    <label class="file-field">
      <input type="file" accept=".zip" class="file-field__input" @change="onChange" />
      <span class="file-field__button">Выбрать ZIP</span>
      <span class="file-field__filename">
        {{ zipName || "Файл не выбран" }}
      </span>
    </label>

    <p v-if="zipName" class="file-field__hint">
      Файл: {{ zipName }} (ожидается /assets/locales/base.json и page.json)
    </p>
  </section>
</template>

<script setup>

const emit = defineEmits(["select"]);

function onChange(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  emit("select", file);
}
</script>
<style scoped>
.block {
  margin-bottom: 18px;
  padding: 16px 18px;
  border-radius: var(--hl-radius);
  background: var(--hl-surface-2);
  border: 1px solid var(--hl-border);
  box-shadow: var(--hl-shadow-sm);

  /* убираем «прыжки» — это детсад */
  transition: background 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
}

.block:hover {
  background: #ffffff;
  border-color: rgba(15, 23, 42, 0.16);
  box-shadow: 0 14px 30px rgba(2, 6, 23, 0.07);
}

.block h2 {
  margin: 0 0 12px;
  font-size: 14px;
  font-weight: 650;
  letter-spacing: 0.01em;
  color: var(--hl-text);
}

.file-field {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;

  padding: 10px 12px;
  border-radius: var(--hl-radius-sm);

  background: #ffffff;
  border: 1px solid rgba(15, 23, 42, 0.14);
  box-shadow: 0 6px 16px rgba(2, 6, 23, 0.06);

  cursor: pointer;
  overflow: hidden;

  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.file-field:hover {
  border-color: rgba(37, 99, 235, 0.35);
  box-shadow: 0 10px 22px rgba(2, 6, 23, 0.08);
}

/* важное: нормальный фокус */
.file-field:focus-within {
  border-color: rgba(37, 99, 235, 0.55);
  box-shadow:
    0 10px 22px rgba(2, 6, 23, 0.08),
    0 0 0 4px var(--hl-focus);
}

.file-field__input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}

.file-field__button {
  flex-shrink: 0;
  padding: 7px 12px;
  border-radius: 10px;

  background: rgba(37, 99, 235, 0.08);
  color: var(--hl-primary);

  font-size: 13px;
  font-weight: 650;
  letter-spacing: 0.01em;

  border: 1px solid rgba(37, 99, 235, 0.18);
  pointer-events: none;
}

.file-field__filename {
  font-size: 13px;
  color: var(--hl-muted);
  white-space: nowrap;
  text-overflow: ellipsis;
  overflow: hidden;
}

.file-field__hint {
  margin: 8px 0 0;
  font-size: 12px;
  color: rgba(71, 85, 105, 0.85);
}
</style>
