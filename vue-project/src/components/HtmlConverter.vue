<template>
  <div class="app">
    <h1>HTML Localizer</h1>

    <!-- ZIP -->
    <section class="block">
      <h2>1. Загрузите ZIP с HTML</h2>

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

      <p v-if="zipName" class="file-field__hint">Файл: {{ zipName }}</p>
    </section>

    <!-- JSON -->
    <section class="block">
      <h2>2. Загрузите JSON с переводами</h2>

      <label class="file-field">
        <input
          type="file"
          accept=".json"
          multiple
          @change="onJsonChange"
          class="file-field__input"
        />
        <span class="file-field__button">Выбрать файлы</span>
        <span class="file-field__filename">
          {{ jsonName || "Файлы не выбраны" }}
        </span>
      </label>

      <p v-if="jsonName" class="file-field__hint">Файлы: {{ jsonName }}</p>
    </section>

    <!-- Кнопка + лог -->
    <section class="block">
      <button :disabled="!canProcess || loading" @click="processArchive">
        {{ loading ? "Обработка..." : "3. Обработать и скачать ZIP" }}
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
</template>




<script setup>
import { ref, computed } from "vue";
import JSZip from "jszip";
import {
  readJsonFile,
  readZipFile,
  getTranslationValue,
  getBaseName,
} from "@/utils/utils";
import { saveAs } from "file-saver";

const zipFile = ref(null);
const zipName = ref("");

const jsonFiles = ref([]);
const jsonName = ref("");

const loading = ref(false);
const error = ref("");
const log = ref("");

const canProcess = computed(
  () => !!zipFile.value && jsonFiles.value.length > 0
);

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
      } else if (
        /не найден|без пары|сохранён как есть|нет перевода/i.test(line)
      ) {
        type = "warn";
      } else if (/готово|обработка завершена|итог/i.test(line)) {
        type = "success";
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

function onJsonChange(e) {
  const files = Array.from(e.target.files || []);
  if (!files.length) return;

  jsonFiles.value = files;
  jsonName.value = files.map((f) => f.name).join(", ");
}

// обработка одного HTML-файла
function processHtmlContent(htmlString, translations, htmlPath) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlString, "text/html");

  const elements = doc.querySelectorAll("[text]");
  const missingKeysSet = new Set();

  elements.forEach((el) => {
    const key = el.getAttribute("text");
    const value = getTranslationValue(translations, key);

    if (value != null) {
      el.innerHTML = value;
      el.removeAttribute("text");
    } else {
      // лог по каждому отсутствующему ключу
      appendLog(
        `[Переводы] Нет перевода для ключа "${key}" в файле "${htmlPath}". Элемент оставлен без изменений.`
      );
      missingKeysSet.add(key);
    }
  });

  if (missingKeysSet.size > 0) {
    appendLog(
      `[Переводы] В файле "${htmlPath}" не найдены переводы для ключей: ${Array.from(
        missingKeysSet
      ).join(", ")}`
    );
  }

  return "<!DOCTYPE html>\n" + doc.documentElement.outerHTML;
}


async function processArchive() {
  error.value = "";
  log.value = "";

  if (!zipFile.value || !jsonFiles.value.length) {
    error.value = "Нужно выбрать ZIP с HTML и хотя бы один JSON с переводами.";
    return;
  }

  loading.value = true;
  try {
    const jsonMap = new Map();

    // читаем все JSON-файлы
    for (const file of jsonFiles.value) {
      const base = getBaseName(file.name);
      try {
        const data = await readJsonFile(file);
        jsonMap.set(base, data);
        appendLog(`[JSON] Файл "${file.name}" успешно прочитан.`);
      } catch (e) {
        console.error(e);
        appendLog(
          `[JSON] Не удалось прочитать файл "${file.name}". Причина: ${
            e.message || e
          }`
        );
      }
    }

    const zip = await readZipFile(zipFile.value);
    const newZip = new JSZip();
    const filePromises = [];

    const htmlBaseNamesInZip = new Set();
    let htmlWithoutJson = 0;
    let jsonWithoutHtml = 0;

    zip.forEach((relativePath, file) => {
      if (!file.dir && relativePath.toLowerCase().endsWith(".html")) {
        const htmlBase = getBaseName(relativePath);
        htmlBaseNamesInZip.add(htmlBase);

        const translationsForThisHtml = jsonMap.get(htmlBase);

        if (!translationsForThisHtml) {
          // нет JSON для этого HTML
          htmlWithoutJson++;
          appendLog(
            `[HTML] Для файла "${relativePath}" не найден файл переводов "${htmlBase}.json". HTML сохранён без изменений.`
          );

          const p = file.async("string").then((content) => {
            newZip.file(relativePath, content);
          });
          filePromises.push(p);
        } else {
          const p = file.async("string").then((content) => {
            const processed = processHtmlContent(
              content,
              translationsForThisHtml,
              relativePath
            );
            newZip.file(relativePath, processed);
          });
          filePromises.push(p);
        }
      } else if (!file.dir) {
        // любые другие файлы копируем как есть
        const p = file.async("arraybuffer").then((content) => {
          newZip.file(relativePath, content);
        });
        filePromises.push(p);
      } else {
        // папки
        newZip.folder(relativePath);
      }
    });

    // JSON без соответствующего HTML
    jsonMap.forEach((_, baseName) => {
      if (!htmlBaseNamesInZip.has(baseName)) {
        jsonWithoutHtml++;
        appendLog(
          `[JSON] Для файла переводов "${baseName}.json" не найден соответствующий HTML-файл в архиве.`
        );
      }
    });

    await Promise.all(filePromises);

    const blob = await newZip.generateAsync({ type: "blob" });
    const baseName = zipName.value.replace(/\.zip$/i, "");
    saveAs(blob, `${baseName}-localized.zip`);

    appendLog("Готово. Обработка завершена, новый ZIP-файл скачан.");
    appendLog(
      `Итог: HTML-файлов в архиве: ${htmlBaseNamesInZip.size}, JSON-файлов: ${jsonMap.size}. Без пары — HTML: ${htmlWithoutJson}, JSON: ${jsonWithoutHtml}.`
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
.app {
  /* max-width: 720px; */
  width: 800px;
  margin: 48px auto;
  padding: 32px 32px 28px;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI",
    sans-serif;
  background: linear-gradient(135deg, #f7f9fc 0%, #ffffff 40%, #edf3ff 100%);
  border-radius: 24px;
  box-shadow:
    0 24px 60px rgba(15, 23, 42, 0.16),
    0 0 0 1px rgba(148, 163, 184, 0.16);
  color: #0f172a;
}

.app > h1 {
  margin: 0 0 24px;
  font-size: 24px;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: #0f172a;
}

/* Карточки-шаги */
.block {
  margin-bottom: 20px;
  padding: 16px 18px 18px;
  border-radius: 18px;
  background: radial-gradient(
      circle at 0 0,
      rgba(191, 219, 254, 0.16),
      transparent 55%
    ),
    #ffffff;
  box-shadow:
    0 14px 35px rgba(15, 23, 42, 0.08),
    0 0 0 1px rgba(226, 232, 240, 0.9);
  transition:
    box-shadow 0.2s ease,
    transform 0.2s ease,
    background 0.2s ease;
}

/* .block:hover {
  transform: translateY(-1px);
  box-shadow:
    0 18px 45px rgba(15, 23, 42, 0.14),
    0 0 0 1px rgba(148, 163, 184, 0.4);
} */

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
  padding: 9px 12px;
  border-radius: 999px;
  background: linear-gradient(145deg, #ffffff, #f3f4f6);
  box-shadow:
    0 1px 0 rgba(255, 255, 255, 0.9),
    0 8px 22px rgba(148, 163, 184, 0.35),
    0 0 0 1px rgba(209, 213, 219, 0.95);
  cursor: pointer;
  overflow: hidden;
  transition:
    box-shadow 0.15s ease,
    transform 0.12s ease,
    background 0.15s ease;
}

.file-field:hover {
  background: linear-gradient(145deg, #f9fafb, #edf2ff);
  box-shadow:
    0 10px 26px rgba(148, 163, 184, 0.5),
    0 0 0 1px rgba(165, 180, 252, 0.9);
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
  padding: 6px 14px;
  border-radius: 999px;
  background: linear-gradient(135deg, #2563eb, #4f46e5);
  color: #ffffff;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.03em;
  box-shadow:
    0 8px 18px rgba(37, 99, 235, 0.5),
    0 0 0 1px rgba(219, 234, 254, 0.9);
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
  padding: 11px 20px;
  border-radius: 999px;
  border: none;
  background: linear-gradient(135deg, #2563eb 0%, #4f46e5 45%, #7c3aed 100%);
  color: #ffffff;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.02em;
  cursor: pointer;
  box-shadow:
    0 0px 17px rgba(37, 99, 235, 0.4),
    0 0 0 1px rgba(191, 219, 254, 0.6);
  transition:
    transform 0.12s ease,
    box-shadow 0.12s ease,
    filter 0.12s ease,
    opacity 0.15s ease;
}

.block button:hover:not([disabled]) {
  transform: translateY(-1px);
  box-shadow:
    0 18px 40px rgba(37, 99, 235, 0.5),
    0 0 0 1px rgba(191, 219, 254, 0.95);
  filter: brightness(1.03);
}

.block button:active:not([disabled]) {
  transform: translateY(0);
  box-shadow:
    0 8px 18px rgba(37, 99, 235, 0.35),
    0 0 0 1px rgba(191, 219, 254, 0.9);
}

.block button[disabled] {
  opacity: 0.55;
  cursor: not-allowed;
  box-shadow:
    0 4px 12px rgba(148, 163, 184, 0.3),
    0 0 0 1px rgba(209, 213, 219, 0.9);
  background: linear-gradient(135deg, #cbd5f5 0%, #e5e7eb 100%);
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
  box-shadow:
    0 6px 16px rgba(248, 113, 113, 0.25),
    inset 0 0 0 1px rgba(254, 226, 226, 0.9);
}

/* Логи */
.log-panel {
  margin-top: 18px;
  padding: 14px 16px 10px;
  border-radius: 18px;
  background:
    radial-gradient(circle at 0 0, rgba(219, 234, 254, 0.6), transparent 55%),
    #f9fafb;
  border: 1px solid rgba(209, 213, 219, 0.9);
  box-shadow:
    0 14px 32px rgba(15, 23, 42, 0.12),
    0 0 0 1px rgba(226, 232, 240, 0.9);
  color: #0f172a;
  font-size: 13px;
  max-height: 260px;
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
  opacity: 0.4;
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
  border-radius: 12px;
  margin-bottom: 4px;
  background: linear-gradient(135deg, #ffffff, #f3f4f6);
  box-shadow:
    0 6px 14px rgba(148, 163, 184, 0.35),
    inset 0 0 0 1px rgba(229, 231, 235, 0.9);
  transition:
    box-shadow 0.15s ease,
    transform 0.15s ease,
    background 0.15s ease;
}

.log-panel__item:last-child {
  margin-bottom: 0;
}

.log-panel__item:hover {
  transform: translateY(-1px);
  background: linear-gradient(135deg, #f9fafb, #edf2ff);
  box-shadow:
    0 10px 24px rgba(148, 163, 184, 0.46),
    inset 0 0 0 1px rgba(209, 213, 219, 1);
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
  background: rgba(59, 130, 246, 0.12);
  color: #1d4ed8;
  box-shadow: 0 0 0 1px rgba(191, 219, 254, 0.9);
}
.log-panel__item--warn .log-panel__badge {
  background: rgba(245, 158, 11, 0.12);
  color: #b45309;
  box-shadow: 0 0 0 1px rgba(252, 211, 77, 0.9);
}
.log-panel__item--error .log-panel__badge {
  background: rgba(239, 68, 68, 0.13);
  color: #b91c1c;
  box-shadow: 0 0 0 1px rgba(254, 202, 202, 0.95);
}
.log-panel__item--success .log-panel__badge {
  background: rgba(16, 185, 129, 0.12);
  color: #047857;
  box-shadow: 0 0 0 1px rgba(167, 243, 208, 0.95);
}

.log-panel__text {
  white-space: pre-wrap;
  color: #111827;
}
</style>

