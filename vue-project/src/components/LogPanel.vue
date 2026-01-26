<template>
  <section class="lp" v-if="entries?.length">
    <header class="lp__header">
      <div class="lp__title">
        <span class="lp__name">{{ title }}</span>

        <span class="lp__summary">
          <span class="lp__pill lp__pill--error">Ошибки: {{ summary.error }}</span>
          <span class="lp__pill lp__pill--warn">Предупр.: {{ summary.warn }}</span>
          <span class="lp__pill lp__pill--info">Инфо: {{ summary.info }}</span>
          <span class="lp__pill lp__pill--success">Готово: {{ summary.success }}</span>
        </span>
      </div>

      <div class="lp__controls" v-if="showControls">
        <div class="lp__filters" v-if="showFilters">
          <button v-for="f in filters" :key="f.value" type="button" class="lp__filter"
            :class="{ 'is-active': filter === f.value }" @click="filter = f.value">
            {{ f.label }}
            <span class="lp__count" v-if="f.value !== 'all'">{{ summary[f.value] }}</span>
          </button>
        </div>

        <label class="lp__search" v-if="showSearch">
          <input v-model="q" type="text" placeholder="Поиск по файлу/ключу/тексту" />
        </label>

        <div class="lp__actions">
          <button type="button" class="lp__btn" @click="copyToClipboard">
            Скопировать
          </button>
          <button v-if="showClear" type="button" class="lp__btn lp__btn--danger" @click="$emit('clear')">
            Очистить
          </button>
        </div>
      </div>
    </header>

    <div class="lp__body">
      <template v-if="groupBy === 'file'">
        <article v-for="group in grouped" :key="group.key" class="lp__group">
          <div class="lp__group-head">
            <span class="lp__file">{{ group.key }}</span>
            <span class="lp__group-meta">{{ group.items.length }} шт.</span>
          </div>

          <ul class="lp__list">
            <li v-for="e in group.items" :key="e.id" class="lp__item" :class="`lp__item--${e.type}`">
              <span class="lp__dot" aria-hidden="true"></span>

              <div class="lp__content">
                <div class="lp__line">
                  <span class="lp__badge">{{ labelOf(e.type) }}</span>

                  <span class="lp__scope" v-if="e.scope">{{ e.scope }}</span>
                  <span class="lp__code" v-if="e.code">{{ e.code }}</span>

                  <span class="lp__times" v-if="e.count && e.count > 1">×{{ e.count }}</span>
                </div>

                <div class="lp__msg">{{ e.message }}</div>

                <div class="lp__meta" v-if="metaLine(e)">
                  {{ metaLine(e) }}
                </div>
              </div>

              <time class="lp__time" v-if="showTime && e.ts" :datetime="iso(e.ts)">
                {{ fmtTime(e.ts) }}
              </time>
            </li>
          </ul>
        </article>
      </template>

      <template v-else>
        <ul class="lp__list">
          <li v-for="e in limitedFlat" :key="e.id" class="lp__item" :class="`lp__item--${e.type}`">
            <span class="lp__dot" aria-hidden="true"></span>

            <div class="lp__content">
              <div class="lp__line">
                <span class="lp__badge">{{ labelOf(e.type) }}</span>

                <span class="lp__scope" v-if="e.scope">{{ e.scope }}</span>
                <span class="lp__file" v-if="e.file">{{ e.file }}</span>
                <span class="lp__code" v-if="e.code">{{ e.code }}</span>

                <span class="lp__times" v-if="e.count && e.count > 1">×{{ e.count }}</span>
              </div>

              <div class="lp__msg">{{ e.message }}</div>

              <div class="lp__meta" v-if="metaLine(e)">
                {{ metaLine(e) }}
              </div>
            </div>

            <time class="lp__time" v-if="showTime && e.ts" :datetime="iso(e.ts)">
              {{ fmtTime(e.ts) }}
            </time>
          </li>
        </ul>
      </template>

      <div v-if="wasTrimmed" class="lp__trim">
        Показаны первые {{ maxItems }} записей (всего {{ filtered.length }}).
      </div>
    </div>
  </section>
</template>

<script setup>
import { computed, ref } from "vue";

const props = defineProps({
  entries: { type: Array, default: () => [] },

  title: { type: String, default: "Журнал обработки" },
  groupBy: { type: String, default: "file" },

  showControls: { type: Boolean, default: true },
  showFilters: { type: Boolean, default: true },
  showSearch: { type: Boolean, default: true },
  showClear: { type: Boolean, default: true },
  showTime: { type: Boolean, default: false },

  maxItems: { type: Number, default: 500 },
  maxPerGroup: { type: Number, default: 200 },
});

defineEmits(["clear"]);

const filter = ref("all");
const q = ref("");

const filters = [
  { value: "all", label: "Все" },
  { value: "error", label: "Ошибки" },
  { value: "warn", label: "Предупр." },
  { value: "info", label: "Инфо" },
  { value: "success", label: "Готово" },
];

const summary = computed(() => {
  const s = { info: 0, warn: 0, error: 0, success: 0 };
  for (const e of props.entries || []) {
    const add = e.count && e.count > 1 ? e.count : 1;
    s[e.type] = (s[e.type] || 0) + add;
  }
  return s;
});

function labelOf(t) {
  if (t === "error") return "Ошибка";
  if (t === "warn") return "Предупреждение";
  if (t === "success") return "Готово";
  return "Инфо";
}

const filtered = computed(() => {
  const list = props.entries || [];

  const byType =
    filter.value === "all" ? list : list.filter((e) => e.type === filter.value);

  const query = q.value.trim().toLowerCase();
  if (!query) return byType;

  return byType.filter((e) => {
    const meta = e.meta ? Object.values(e.meta).map(String) : [];
    const hay = [e.message, e.file || "", e.code || "", e.scope || "", ...meta]
      .join(" ")
      .toLowerCase();
    return hay.includes(query);
  });
});

const wasTrimmed = computed(() => filtered.value.length > props.maxItems);
const limitedFlat = computed(() => filtered.value.slice(0, props.maxItems));

const grouped = computed(() => {
  const map = new Map();

  for (const e of limitedFlat.value) {
    const key = e.file || "Без файла";
    const arr = map.get(key) || [];
    arr.push(e);
    map.set(key, arr);
  }

  return Array.from(map.entries()).map(([key, items]) => ({
    key,
    items: items.slice(0, props.maxPerGroup),
  }));
});

function metaLine(e) {
  if (!e.meta) return "";
  const pick = ["key", "selector", "path"];
  const parts = [];

  for (const k of pick) {
    const v = e.meta[k];
    if (v) parts.push(`${k}: ${String(v)}`);
  }
  return parts.join(" · ");
}

function iso(ts) {
  return new Date(ts).toISOString();
}

function fmtTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

async function copyToClipboard() {
  const lines = [];
  lines.push(props.title);
  lines.push(
    `Ошибки: ${summary.value.error} | Предупр.: ${summary.value.warn} | Инфо: ${summary.value.info} | Готово: ${summary.value.success}`
  );
  lines.push("");

  for (const e of limitedFlat.value) {
    const head = [
      `[${String(e.type || "info").toUpperCase()}]`,
      e.scope ? `[${e.scope}]` : "",
      e.file ? `${e.file}` : "",
      e.code ? `(${e.code})` : "",
      e.count && e.count > 1 ? `x${e.count}` : "",
    ]
      .filter(Boolean)
      .join(" ");

    const tail = metaLine(e);
    lines.push(`${head} ${e.message}${tail ? ` — ${tail}` : ""}`);
  }

  const text = lines.join("\n");

  try {
    await navigator.clipboard.writeText(text);
  } catch {
    window.prompt("Скопируйте вручную:", text);
  }
}
</script>

<style scoped>
.lp {
  margin-top: 18px;
  border-radius: 16px;
  background: #fff;
  border: 1px solid rgba(17, 24, 39, 0.08);
}

.lp__header {
  padding: 12px 14px;
  border-bottom: 1px solid rgba(17, 24, 39, 0.08);
  display: grid;
  gap: 10px;
}

.lp__title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.lp__name {
  font-size: 13px;
  font-weight: 650;
  color: #111827;
}

.lp__summary {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.lp__pill {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid rgba(17, 24, 39, 0.1);
  color: #111827;
  background: rgba(17, 24, 39, 0.03);
}

.lp__pill--error {
  background: rgba(239, 68, 68, 0.08);
  border-color: rgba(239, 68, 68, 0.18);
}

.lp__pill--warn {
  background: rgba(245, 158, 11, 0.1);
  border-color: rgba(245, 158, 11, 0.22);
}

.lp__pill--info {
  background: rgba(59, 130, 246, 0.08);
  border-color: rgba(59, 130, 246, 0.18);
}

.lp__pill--success {
  background: rgba(16, 185, 129, 0.1);
  border-color: rgba(16, 185, 129, 0.22);
}

.lp__controls {
  display: grid;
  grid-template-columns: 1fr minmax(180px, 260px) auto;
  gap: 10px;
  align-items: center;
}

@media (max-width: 860px) {
  .lp__controls {
    grid-template-columns: 1fr;
  }
}

.lp__filters {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.lp__filter {
  border: 1px solid rgba(17, 24, 39, 0.1);
  background: transparent;
  color: #111827;
  font-size: 12px;
  padding: 6px 10px;
  border-radius: 10px;
  cursor: pointer;
}

.lp__filter.is-active {
  background: rgba(17, 24, 39, 0.06);
  border-color: rgba(17, 24, 39, 0.18);
}

.lp__count {
  margin-left: 6px;
  font-size: 11px;
  opacity: 0.8;
}

.lp__search input {
  width: 100%;
  height: 34px;
  border-radius: 10px;
  border: 1px solid rgba(17, 24, 39, 0.1);
  padding: 0 10px;
  font-size: 12px;
  outline: none;
}

.lp__search input:focus {
  border-color: rgba(17, 24, 39, 0.22);
}

.lp__actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

.lp__btn {
  height: 34px;
  padding: 0 10px;
  font-size: 12px;
  border-radius: 10px;
  border: 1px solid rgba(17, 24, 39, 0.1);
  background: transparent;
  cursor: pointer;
  color: #111827;
}

.lp__btn--danger {
  border-color: rgba(239, 68, 68, 0.22);
}

.lp__body {
  padding: 10px 12px 12px;
  /* max-height: 420px; */
  overflow: auto;
}

.lp__group {
  margin-bottom: 12px;
}

.lp__group:last-child {
  margin-bottom: 0;
}

.lp__group-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  padding: 8px 8px;
  background: rgba(17, 24, 39, 0.03);
  border: 1px solid rgba(17, 24, 39, 0.06);
  border-radius: 12px;
  font-size: 12px;
}

.lp__file {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas,
    "Liberation Mono", "Courier New", monospace;
  font-size: 12px;
  color: #111827;
}

.lp__group-meta {
  font-size: 11px;
  opacity: 0.75;
}

.lp__list {
  list-style: none;
  margin: 8px 0 0;
  padding: 0;
}

.lp__item {
  display: grid;
  grid-template-columns: 10px 1fr auto;
  gap: 10px;
  align-items: start;
  padding: 8px 8px;
  border-bottom: 1px solid rgba(17, 24, 39, 0.06);
}

.lp__item:last-child {
  border-bottom: none;
}

.lp__dot {
  width: 8px;
  height: 8px;
  margin-top: 5px;
  border-radius: 999px;
  background: rgba(17, 24, 39, 0.3);
}

.lp__item--info .lp__dot {
  background: rgba(59, 130, 246, 0.9);
}

.lp__item--warn .lp__dot {
  background: rgba(245, 158, 11, 0.9);
}

.lp__item--error .lp__dot {
  background: rgba(239, 68, 68, 0.95);
}

.lp__item--success .lp__dot {
  background: rgba(16, 185, 129, 0.95);
}

.lp__content {
  min-width: 0;
}

.lp__line {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
  margin-bottom: 2px;
}

.lp__badge {
  font-size: 11px;
  padding: 1px 7px;
  border-radius: 999px;
  border: 1px solid rgba(17, 24, 39, 0.1);
  background: rgba(17, 24, 39, 0.03);
}

.lp__scope,
.lp__code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas,
    "Liberation Mono", "Courier New", monospace;
  font-size: 11px;
  opacity: 0.85;
}

.lp__times {
  font-size: 11px;
  opacity: 0.75;
}

.lp__msg {
  font-size: 12px;
  line-height: 1.35;
  color: #111827;
  overflow-wrap: anywhere;
}

.lp__meta {
  margin-top: 2px;
  font-size: 11px;
  opacity: 0.75;
  overflow-wrap: anywhere;
}

.lp__time {
  font-size: 11px;
  opacity: 0.6;
  white-space: nowrap;
  padding-left: 8px;
}

.lp__trim {
  margin-top: 10px;
  font-size: 11px;
  opacity: 0.7;
}
</style>
