// src/composables/useLogs.js
import { computed, ref } from "vue";

/**
 * @typedef {Object} UseLogsOptions
 * @property {boolean=} dedupe
 * @property {number=} max
 */

/**
 * @param {UseLogsOptions=} options
 */
export function useLogs(options) {
  const { dedupe = true, max = 5000 } = options || {};

  const entries = ref([]);
  const dedupeMap = new Map();
  let seq = 0;

  const summary = computed(() => {
    const s = { info: 0, warn: 0, error: 0, success: 0 };
    for (const e of entries.value) {
      const add = e.count && e.count > 1 ? e.count : 1;
      s[e.type] = (s[e.type] || 0) + add;
    }
    return s;
  });

  function makeId() {
    seq += 1;
    return `${Date.now().toString(36)}-${seq.toString(36)}`;
  }

  function makeKey(e) {
    return [
      e.type,
      e.scope || "",
      e.file || "",
      e.code || "",
      e.message || "",
      e.meta ? JSON.stringify(e.meta) : "",
    ].join("|");
  }

  function rebuildIndex() {
    dedupeMap.clear();
    entries.value.forEach((e, i) => dedupeMap.set(makeKey(e), i));
  }

  function push(input) {
    const item = {
      id: input.id || makeId(),
      ts: input.ts ?? Date.now(),
      type: input.type || "info",
      scope: input.scope,
      file: input.file,
      code: input.code,
      message: input.message || "",
      meta: input.meta,
      count: input.count ?? 1,
    };

    if (dedupe) {
      const key = makeKey(item);
      const idx = dedupeMap.get(key);
      if (idx != null) {
        const existing = entries.value[idx];
        existing.count = (existing.count ?? 1) + (item.count ?? 1);
        existing.ts = item.ts;
        return;
      }
      dedupeMap.set(key, entries.value.length);
    }

    entries.value.push(item);

    if (entries.value.length > max) {
      entries.value.splice(0, entries.value.length - max);
      if (dedupe) rebuildIndex();
    }
  }

  function clear() {
    entries.value = [];
    dedupeMap.clear();
  }

  function log(type, message, extra = {}) {
    push({ type, message, ...extra });
  }

  return {
    entries,
    summary,
    push,
    clear,
    log,
    info: (message, extra) => log("info", message, extra),
    warn: (message, extra) => log("warn", message, extra),
    error: (message, extra) => log("error", message, extra),
    success: (message, extra) => log("success", message, extra),
  };
}
