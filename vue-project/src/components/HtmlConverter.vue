<template>
  <div class="app-layout">
    <CatWrapper>
      <div class="app">
        <h1>HTML Localizer</h1>

        <!-- ZIP (HTML + assets/locales/*.json) -->
        <section class="block">
          <h2>1. Загрузите ZIP с версткой и переводами</h2>

          <label class="file-field">
            <input
              type="file"
              accept=".zip"
              @change="onZipChange"
              class="file-field__input"
            />
            <span class="file-field__button">Выбрать ZIP</span>
            <span class="file-field__filename">
              {{ zipName || "Файл не выбран" }}
            </span>
          </label>

          <p v-if="zipName" class="file-field__hint">
            Файл: {{ zipName }} (ожидается /assets/locales/base.json и page.json)
          </p>
        </section>

        <!-- Кнопка + лог -->
        <section class="block">
          <button :disabled="!canProcess || loading" @click="processArchive">
            {{ loading ? "Обработка..." : "2. Обработать и скачать ZIP" }}
          </button>

          <p v-if="error" class="error-msg">{{ error }}</p>

          <div v-if="logEntries.length" class="log-panel">
            <div class="log-panel__header">Журнал обработки</div>
            <ul class="log-panel__list">
              <li
                v-for="entry in logEntries"
                :key="entry.id"
                :class="['log-panel__item', `log-panel__item--${entry.type}`]"
              >
                <span class="log-panel__badge">
                  {{
                    entry.type === "error"
                      ? "Ошибка"
                      : entry.type === "warn"
                      ? "Предупреждение"
                      : entry.type === "success"
                      ? "Готово"
                      : "Лог"
                  }}
                </span>
                <span class="log-panel__text">{{ entry.text }}</span>
              </li>
            </ul>
          </div>
        </section>
      </div>
    </CatWrapper>
  </div>
</template>

<script setup>
import CatWrapper from "@/components/CatWrapper.vue";
import { ref, computed } from "vue";
import JSZip from "jszip";
import {
  readZipFile,
  getTranslationValue,
  getBaseName,
  getElementPath,
} from "@/utils/utils";
import { saveAs } from "file-saver";

const zipFile = ref(null);
const zipName = ref("");

// базовый json с общими переводами (кнопки, ссылки и т.п.)
const baseTranslations = ref(null);

const loading = ref(false);
const error = ref("");
const log = ref("");

// теперь обрабатываем только ZIP, без отдельного выбора JSON
const canProcess = computed(() => !!zipFile.value);

// превращаем общий лог в массив записей с типами
const logEntries = computed(() => {
  if (!log.value) return [];
  return log.value
    .split("\n")
    .filter(Boolean)
    .map((line, index) => {
      let type = "info";

      if (/ошибка|не удалось/i.test(line)) {
        type = "error";
      } else if (/готово|обработка завершена|итог/i.test(line)) {
        // сначала успех
        type = "success";
      } else if (/не найден|без пары|сохранён как есть|нет перевода/i.test(line)) {
        // потом уже предупреждения
        type = "warn";
      }

      return { id: index, type, text: line };
    });
});

function appendLog(message) {
  log.value += (log.value ? "\n" : "") + message;
}

function onZipChange(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  zipFile.value = file;
  zipName.value = file.name;
}

// =======================
//   MERGE ХЕЛПЕРЫ
// =======================

function isPlainObject(obj) {
  return obj && typeof obj === "object" && !Array.isArray(obj);
}

// аккуратный deep-merge без мутации исходников
function deepMerge(target, source) {
  const output = { ...target };

  if (!isPlainObject(source)) return output;

  Object.keys(source).forEach((key) => {
    const sourceVal = source[key];
    const targetVal = output[key];

    if (isPlainObject(sourceVal) && isPlainObject(targetVal)) {
      output[key] = deepMerge(targetVal, sourceVal);
    } else {
      output[key] = sourceVal;
    }
  });

  return output;
}

// итоговые переводы для HTML: base.json + page.json (page имеет приоритет)
function buildTranslations(base, page) {
  if (!base || !page) return null; // оба обязательны
  return deepMerge(base, page);
}

// alt для всех img
function applyAltForImages(doc) {
  const images = doc.querySelectorAll("img");
  images.forEach((img) => {
    img.setAttribute("alt", "img");
  });
}

// проверка наличия текста в верстке (до замены переводами)
function checkForRawText(doc, htmlPath) {
  const root = doc.body || doc;
  if (!root) return;

  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  const rawFragments = [];

  let node;
  while ((node = walker.nextNode())) {
    const text = node.nodeValue || "";
    const trimmed = text.trim();

    if (!trimmed) continue;

    const parent = node.parentElement;
    if (!parent) continue;

    const tag = parent.tagName.toLowerCase();
    if (tag === "script" || tag === "style" || tag === "noscript") continue;

    // если текст внутри элемента, который уже локализуется через [text] — пропускаем
    if (parent.closest("[text]")) continue;

    // отбрасываем чистую пунктуацию/пробелы
    if (!/[A-Za-zА-Яа-я0-9]/.test(trimmed)) continue;

    rawFragments.push({
      text: trimmed,
      selector: getElementPath(parent),
    });
  }

  if (rawFragments.length === 0) return;

  const limit = 20;

  rawFragments.slice(0, limit).forEach((frag) => {
    appendLog(
      `есть текст "${frag.text}" в файле "${htmlPath}", необходимо перенести в json`
      // можно добавить селектор, если нужно:
      // + ` (элемент: ${frag.selector})`
    );
  });

  if (rawFragments.length > limit) {
    appendLog(
      `[Проверка текста] Показаны только первые ${limit} фрагментов, всего найдено ${rawFragments.length}.`
    );
  }
}

function removeLocaleScriptTags(doc) {
  const scripts = doc.querySelectorAll("script[src]");

  scripts.forEach((script) => {
    const src = script.getAttribute("src") || "";

    // матчит:
    // /assets/js/local.js
    // ./local.js
    // /js/locale.js?v=123 и т.п.
    if (/(^|\/)(locale)\.js(\?.*)?$/i.test(src)) {
      script.remove();
    }
  });
}

// обработка одного HTML-файла
function processHtmlContent(htmlString, translations, htmlPath) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlString, "text/html");
  removeLocaleScriptTags(doc, htmlPath);
  // сначала ищем "голый" текст в верстке
  checkForRawText(doc, htmlPath);

  const elements = doc.querySelectorAll("[text]");
  const missingKeysSet = new Set();


  elements.forEach((el) => {
    applyAltForImages(doc);

    const key = el.getAttribute("text");
    const value = getTranslationValue(translations, key);

    if (value != null) {
      if (el.tagName.toLowerCase() === "input") {
        el.setAttribute("placeholder", value);
      } else {
        el.innerHTML = value;
      }

      el.removeAttribute("text");
    } else {
      appendLog(
        `[Переводы] Нет перевода для ключа "${key}" в файле "${htmlPath}". Элемент оставлен без изменений.`
      );
      missingKeysSet.add(key);
    }
  });



  return "<!DOCTYPE html>\n" + doc.documentElement.outerHTML;
}

// замена __t("key") в JS по baseTranslations
function processJsContent(content, baseTranslations, fileName) {
  if (!baseTranslations) {
    appendLog(
      `[JS] Для файла "${fileName}" не найден base.json. JS сохранён без изменений.`
    );
    return content;
  }

  const regex = /__t\(\s*(['"`])([^'"`]+)\1\s*(?:,[^)]+)?\)/g;

  return content.replace(regex, (match, _quote, keyPath) => {
    const value = getTranslationValue(baseTranslations, keyPath);

    if (value == null) {
      appendLog(
        `[JS] Не найден перевод для ключа "${keyPath}" в base.json (файл: "${fileName}"). Оставляю __t(...) как есть.`
      );
      return match;
    }

    const escaped = String(value)
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\n/g, "\\n");

    return `"${escaped}"`;
  });
}


async function processArchive() {
  error.value = "";
  log.value = "";
  baseTranslations.value = null;

  if (!zipFile.value) {
    error.value = "Нужно выбрать ZIP с HTML и переводами.";
    return;
  }

  loading.value = true;
  try {
    const zip = await readZipFile(zipFile.value);

    // 1. Тянем JSON из assets/locales
    const jsonMap = new Map();
    const jsonReadPromises = [];

    zip.forEach((relativePath, file) => {
      if (file.dir) return;

      const lower = relativePath.toLowerCase();
      if (!lower.endsWith(".json")) return;
      if (!lower.startsWith("assets/locales/")) return;

      const baseName = getBaseName(relativePath);

      const p = file.async("string").then((content) => {
        try {
          const data = JSON.parse(content);

          if (baseName.toLowerCase() === "base") {
            baseTranslations.value = data;
          } else {
            jsonMap.set(baseName, data);
          }
        } catch (e) {
          appendLog(
            `[JSON] Не удалось распарсить "${relativePath}" как JSON. Причина: ${
              e.message || e
            }`
          );
        }
      });

      jsonReadPromises.push(p);
    });

    await Promise.all(jsonReadPromises);

    if (!baseTranslations.value) {
      const msg =
        'Не найден обязательный файл переводов "assets/locales/base.json" внутри ZIP.';
      error.value = msg;
      appendLog(`[JSON] ${msg}`);
      loading.value = false;
      return;
    }

    // 2. Собираем новый ZIP, БЕЗ assets/locales и local(e).js
    const newZip = new JSZip();
    const filePromises = [];

    const htmlBaseNamesInZip = new Set();
    let htmlWithoutJson = 0;
    let jsonWithoutHtml = 0;

    zip.forEach((relativePath, file) => {
      const lower = relativePath.toLowerCase();
      const fileNameOnly = relativePath.split("/").pop().toLowerCase();

      // --- срезаем целиком assets/locales (и папку, и файлы) ---
      if (
        lower === "assets/locales" ||
        lower === "assets/locales/" ||
        lower.startsWith("assets/locales/")
      ) {

        return;
      }

      // --- выкидываем скрипт локализации local.js / locale.js ---
      if (fileNameOnly === "local.js" || fileNameOnly === "locale.js") {
        return;
      }

      // папки (кроме locales, мы их уже отфильтровали выше)
      if (file.dir) {
        newZip.folder(relativePath);
        return;
      }

      // HTML
      if (lower.endsWith(".html")) {
        const htmlBase = getBaseName(relativePath);
        htmlBaseNamesInZip.add(htmlBase);

        const pageTranslations = jsonMap.get(htmlBase);
        const mergedTranslations = buildTranslations(
          baseTranslations.value,
          pageTranslations
        );

        if (!mergedTranslations) {
          htmlWithoutJson++;
          if (!pageTranslations) {
            appendLog(
              `[HTML] Для файла "${relativePath}" не найден обязательный "assets/locales/${htmlBase}.json". HTML сохранён без изменений.`
            );
          } else {
            appendLog(
              `[HTML] Для файла "${relativePath}" не удалось собрать обязательные переводы (base + ${htmlBase}.json). HTML сохранён без изменений.`
            );
          }

          const p = file.async("string").then((content) => {
            newZip.file(relativePath, content);
          });
          filePromises.push(p);
        } else {
          const p = file.async("string").then((content) => {
            const processed = processHtmlContent(
              content,
              mergedTranslations,
              relativePath
            );
            newZip.file(relativePath, processed);
          });
          filePromises.push(p);
        }

        return;
      }

      // JS — умная замена __t("key") по base.json
      if (lower.endsWith(".js")) {
        const p = file.async("string").then((content) => {
          const processed = processJsContent(
            content,
            baseTranslations.value,
            relativePath
          );
          newZip.file(relativePath, processed);
        });
        filePromises.push(p);
        return;
      }

      // Остальные файлы — как есть
      const p = file.async("arraybuffer").then((content) => {
        newZip.file(relativePath, content);
      });
      filePromises.push(p);
    });

    // JSON без соответствующего HTML (кроме base.json)
    jsonMap.forEach((_, baseName) => {
      if (!htmlBaseNamesInZip.has(baseName)) {
        jsonWithoutHtml++;
        appendLog(
          `[JSON] Для файла переводов "assets/locales/${baseName}.json" не найден соответствующий HTML-файл в архиве.`
        );
      }
    });

    await Promise.all(filePromises);

    const blob = await newZip.generateAsync({ type: "blob" });
    const baseName = zipName.value.replace(/\.zip$/i, "");
    saveAs(blob, `${baseName}-localized.zip`);

    const totalJsonFiles = jsonMap.size + 1; // +1 за base.json

    appendLog("Готово. Обработка завершена, новый ZIP-файл скачан.");
    appendLog(
      `Итог: HTML-файлов в архиве: ${htmlBaseNamesInZip.size}, JSON-файлов (включая base.json): ${totalJsonFiles}. Без пары — HTML: ${htmlWithoutJson}, JSON: ${jsonWithoutHtml}.`
    );
  } catch (e) {
    console.error(e);
    error.value = e?.message || "Произошла ошибка при обработке архива.";
    appendLog(
      `[Система] Критическая ошибка при обработке архива: ${e?.message || e}`
    );
  } finally {
    loading.value = false;
  }
}

</script>


<style scoped>
/* Лейаут: конвертер + сайдбар */
.app-layout {
  /* display: grid; */
  /* grid-template-columns: minmax(0, 2.2fr) minmax(260px, 1fr); */
  gap: 20px;
  /* align-items: flex-start; */
  max-width: 1180px;
  margin: 0 auto;
  padding: 24px 16px;
  overflow-wrap: anywhere;
}

/* Основная карточка приложения */
.app {
  width: auto; /* было 800px */
  margin: 0; /* убираем auto центрирование, центр теперь у .app-layout */
  padding: 28px 32px 28px;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background: radial-gradient(circle at 10% 0%, #fde7d6 0%, transparent 50%),
    radial-gradient(circle at 90% 0%, #e7ddff 0%, transparent 55%), #fdfaf7;
  border-radius: 28px;
  box-shadow: 0 26px 60px rgba(15, 23, 42, 0.16), 0 0 0 1px rgba(241, 245, 249, 0.9);
  color: #111827;
}

 h1 {
  margin: 0 0 24px;
  font-size: 24px;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: #111827;
}

/* Сайдбар с логами по языку */
.app__sidebar {
  align-self: stretch;
  padding: 4px 0;
}

.log-block {
  position: sticky;
  top: 16px;
  border-radius: 20px;
padding: 28px 32px 28px;
  background: radial-gradient(circle at 100% 0, rgba(219, 234, 254, 0.7), transparent 60%), #f9fafb;
  box-shadow: 0 18px 40px rgba(15, 23, 42, 0.12), 0 0 0 1px rgba(229, 231, 235, 0.9);
  font-size: 12px;
  color: #111827;
  max-height: 420px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  margin-top: 80px;
}

.log-block__title {
  margin: 0 0 8px;
  font-size: 13px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 6px;
}

.log-block__title::before {
  content: "";
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: linear-gradient(135deg, #6366f1, #ec4899);
  box-shadow: 0 0 0 4px rgba(129, 140, 248, 0.25);
}

.log-list {
  list-style: none;
  margin: 0;
  padding: 4px 0 0;
  overflow-y: auto;
  scrollbar-width: thin;
}

.log-list::-webkit-scrollbar {
  width: 6px;
}
.log-list::-webkit-scrollbar-thumb {
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.7);
}

/* Элементы логов по языку */
.log-item {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 6px 8px;
  border-radius: 12px;
  margin-bottom: 4px;
  background: rgba(255, 255, 255, 0.9);
  box-shadow: 0 4px 10px rgba(148, 163, 184, 0.25), inset 0 0 0 1px rgba(229, 231, 235, 0.9);
  transition: transform 0.12s ease, box-shadow 0.12s ease, background 0.12s ease;
}

.log-item:last-child {
  margin-bottom: 0;
}

.log-item:hover {
  transform: translateY(-1px);
  background: #f9fafb;
  box-shadow: 0 8px 18px rgba(148, 163, 184, 0.4), inset 0 0 0 1px rgba(209, 213, 219, 1);
}

.log-item__dot {
  flex-shrink: 0;
  width: 6px;
  height: 6px;
  margin-top: 5px;
  border-radius: 999px;
  background: #9ca3af;
}

/* Цвета статусов */
.log-item--info .log-item__dot {
  background: #3b82f6;
}
.log-item--warn .log-item__dot {
  background: #f59e0b;
}
.log-item--error .log-item__dot {
  background: #ef4444;
}
.log-item--success .log-item__dot {
  background: #10b981;
}

.log-item__text {
  font-size: 11px;
  line-height: 1.4;
  color: #111827;
  white-space: pre-wrap;
}

/* Карточки-шаги */
.block {
  margin-bottom: 20px;
  padding: 16px 18px 18px;
  border-radius: 20px;
  background: radial-gradient(circle at 0 0, rgba(253, 230, 205, 0.5), transparent 55%), #fffdf9;
  box-shadow: 0 14px 32px rgba(15, 23, 42, 0.08), 0 0 0 1px rgba(243, 244, 246, 0.95);
  transition: box-shadow 0.2s ease, transform 0.2s ease, background 0.2s ease;
}

.block:hover {
  transform: translateY(-1px);
  box-shadow: 0 18px 40px rgba(15, 23, 42, 0.12), 0 0 0 1px rgba(229, 231, 235, 1);
  background: radial-gradient(circle at 0 0, rgba(253, 230, 205, 0.7), transparent 55%), #fffaf4;
}

.block h2 {
  margin: 0 0 12px;
  font-size: 16px;
  font-weight: 600;
  color: #111827;
}

/* Кастомное поле выбора файла */
.file-field {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 14px;
  border-radius: 999px;
  background: linear-gradient(145deg, #fffdf9, #f5f0ea);
  box-shadow: 0 1px 0 rgba(255, 255, 255, 0.9), 0 8px 20px rgba(148, 163, 184, 0.35),
    0 0 0 1px rgba(229, 231, 235, 0.98);
  cursor: pointer;
  overflow: hidden;
  transition: box-shadow 0.15s ease, transform 0.12s ease, background 0.15s ease;
}

.file-field:hover {
  background: linear-gradient(145deg, #fffaf4, #f3ece4);
  box-shadow: 0 10px 26px rgba(148, 163, 184, 0.5), 0 0 0 1px rgba(248, 231, 209, 0.95);
  transform: translateY(-1px);
}

.file-field__input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}

/* «Кнопка» внутри поля */
.file-field__button {
  flex-shrink: 0;
  padding: 6px 16px;
  border-radius: 999px;
  background: linear-gradient(135deg, #6366f1, #a855f7);
  color: #ffffff;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.03em;
  box-shadow: 0 8px 18px rgba(129, 140, 248, 0.55), 0 0 0 1px rgba(238, 242, 255, 0.95);
  pointer-events: none;
}

/* Имя файла */
.file-field__filename {
  font-size: 13px;
  color: #4b5563;
  white-space: nowrap;
  text-overflow: ellipsis;
  overflow: hidden;
}

/* Подпись под полем */
.file-field__hint {
  margin: 6px 0 0;
  font-size: 12px;
  color: #6b7280;
}

/* Кнопка запуска */
.block button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 260px;
  padding: 11px 22px;
  border-radius: 999px;
  border: none;
  background: linear-gradient(135deg, #6366f1 0%, #a855f7 45%, #ec4899 100%);
  color: #ffffff;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.02em;
  cursor: pointer;
  box-shadow: 0 0px 18px rgba(129, 140, 248, 0.5), 0 0 0 1px rgba(226, 232, 240, 0.9);
  transition: transform 0.12s ease, box-shadow 0.12s ease, filter 0.12s ease, opacity 0.15s ease;
}

.block button:hover:not([disabled]) {
  transform: translateY(-1px);
  box-shadow: 0 18px 40px rgba(129, 140, 248, 0.55), 0 0 0 1px rgba(226, 232, 240, 1);
  filter: brightness(1.03);
}

.block button:active:not([disabled]) {
  transform: translateY(0);
  box-shadow: 0 8px 18px rgba(129, 140, 248, 0.35), 0 0 0 1px rgba(226, 232, 240, 0.95);
}

.block button[disabled] {
  opacity: 0.6;
  cursor: not-allowed;
  box-shadow: 0 4px 12px rgba(148, 163, 184, 0.3), 0 0 0 1px rgba(229, 231, 235, 0.95);
  background: linear-gradient(135deg, #e5e7f5 0%, #e5e7eb 100%);
}

/* Ошибка */
.error-msg {
  margin-top: 12px;
  font-size: 13px;
  color: #b91c1c;
  padding: 8px 10px;
  border-radius: 12px;
  background: linear-gradient(135deg, #fef2f2, #fee2e2);
  border: 1px solid #fecaca;
  box-shadow: 0 6px 16px rgba(248, 113, 113, 0.22), inset 0 0 0 1px rgba(254, 226, 226, 0.95);
}

/* Логи основной панели */
.log-panel {
  margin-top: 18px;
  padding: 14px 16px 10px;
  border-radius: 20px;
  background: radial-gradient(circle at 0 0, rgba(252, 231, 206, 0.5), transparent 55%), #fdf7f2;
  border: 1px solid rgba(229, 231, 235, 0.95);
  box-shadow: 0 14px 30px rgba(15, 23, 42, 0.12), 0 0 0 1px rgba(243, 244, 246, 0.95);
  color: #111827;
  font-size: 13px;
  overflow-y: auto;
  backdrop-filter: blur(6px);
}

.log-panel__header {
  font-weight: 600;
  font-size: 13px;
  margin-bottom: 8px;
  color: #111827;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.log-panel__header::after {
  content: "⟳";
  font-size: 11px;
  opacity: 0.35;
}

.log-panel__list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.log-panel__item {
  display: flex;
  text-align: center;
  align-items: center;
  gap: 8px;
  padding: 7px 9px;
  border-radius: 14px;
  margin-bottom: 4px;
  background: linear-gradient(135deg, #ffffff, #f5f0ea);
  box-shadow: 0 6px 14px rgba(148, 163, 184, 0.32), inset 0 0 0 1px rgba(229, 231, 235, 0.9);
  transition: box-shadow 0.15s ease, transform 0.15s ease, background 0.15s ease;
}

.log-panel__item:last-child {
  margin-bottom: 0;
}

.log-panel__item:hover {
  transform: translateY(-1px);
  background: linear-gradient(135deg, #fffaf4, #f3ece4);
  box-shadow: 0 10px 24px rgba(148, 163, 184, 0.44), inset 0 0 0 1px rgba(209, 213, 219, 1);
}

.log-panel__badge {
  flex-shrink: 0;
  font-size: 11px;
  padding: 2px 7px;
  border-radius: 999px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  font-weight: 600;
}

.log-panel__item--info .log-panel__badge {
  background: rgba(59, 130, 246, 0.08);
  color: #1d4ed8;
  box-shadow: 0 0 0 1px rgba(191, 219, 254, 0.9);
}
.log-panel__item--warn .log-panel__badge {
  background: rgba(245, 158, 11, 0.09);
  color: #b45309;
  box-shadow: 0 0 0 1px rgba(252, 211, 77, 0.9);
}
.log-panel__item--error .log-panel__badge {
  background: rgba(239, 68, 68, 0.11);
  color: #b91c1c;
  box-shadow: 0 0 0 1px rgba(254, 202, 202, 0.95);
}
.log-panel__item--success .log-panel__badge {
  background: rgba(16, 185, 129, 0.11);
  color: #047857;
  box-shadow: 0 0 0 1px rgba(167, 243, 208, 0.95);
}

.log-panel__text {
  white-space: pre-wrap;
  color: #111827;
}

/* Респонсив, чтобы на маленьких экранах всё падало в столбик */
@media (max-width: 900px) {
  .app-layout {
    grid-template-columns: minmax(0, 1fr);
  }

  .app__sidebar {
    order: -1;
  }
}
</style>
