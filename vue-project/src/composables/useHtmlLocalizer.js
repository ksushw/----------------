import { ref, computed } from "vue";
import JSZip from "jszip";
import { saveAs } from "file-saver";
import { useLogs } from "@/composables/useLogs";
import { readZipFile, getTranslationValue, getBaseName, getElementPath } from "@/utils/utils";
import { buildTranslations } from "@/utils/htmlLocalizer/merge";
import { processHtmlContent } from "@/utils/htmlLocalizer/html";
import { processJsContent } from "@/utils/htmlLocalizer/js";

export function useHtmlLocalizer() {
  const {
    entries,
    clear,
    info,
    warn,
    error: logError,
    success,
  } = useLogs({
    dedupe: true,
    max: 5000,
  });

  const zipFile = ref(null);
  const zipName = ref("");
  const baseTranslations = ref(null);
  const loading = ref(false);

  // UI-ошибка (ранее у тебя было error.value, но это ломало код)
  const uiError = ref("");

  const canProcess = computed(() => !!zipFile.value);

  function setZipFile(file) {
    zipFile.value = file;
    zipName.value = file?.name || "";
  }

  async function processArchive() {
    uiError.value = "";
    baseTranslations.value = null;

    if (!zipFile.value) {
      uiError.value = "Нужно выбрать ZIP с HTML и переводами.";
      return;
    }

    loading.value = true;

    try {
      const zip = await readZipFile(zipFile.value);
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
            logError("Не удалось распарсить JSON", {
              scope: "JSON",
              file: relativePath,
              code: "JSON_PARSE_ERROR",
              meta: { reason: e?.message || String(e) },
            });
          }
        });

        jsonReadPromises.push(p);
      });

      await Promise.all(jsonReadPromises);

      if (!baseTranslations.value) {
        const msg = 'Не найден обязательный файл переводов "assets/locales/base.json" внутри ZIP.';
        uiError.value = msg;

        logError(msg, {
          scope: "JSON",
          code: "BASE_JSON_MISSING",
          meta: { expected: "assets/locales/base.json" },
        });

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
          const mergedTranslations = buildTranslations(baseTranslations.value, pageTranslations);

          if (!mergedTranslations) {
            htmlWithoutJson++;

            if (!pageTranslations) {
              warn("Не найден обязательный файл переводов страницы — HTML сохранён без изменений", {
                scope: "HTML",
                file: relativePath,
                code: "PAGE_JSON_MISSING",
                meta: { expected: `assets/locales/${htmlBase}.json` },
              });
            } else {
              warn("Не удалось собрать переводы (base + page) — HTML сохранён без изменений", {
                scope: "HTML",
                file: relativePath,
                code: "TRANSLATIONS_MERGE_FAILED",
                meta: { pageJson: `assets/locales/${htmlBase}.json` },
              });
            }

            const p = file.async("string").then((content) => {
              newZip.file(relativePath, content);
            });
            filePromises.push(p);
          } else {
            const p = file.async("string").then((content) => {
              const processed = processHtmlContent(content, mergedTranslations, relativePath, {
                warn,
                info,
                getTranslationValue,
                getElementPath,
              });
              newZip.file(relativePath, processed);
            });
            filePromises.push(p);
          }

          return;
        }

        // JS — умная замена __t("key") по base.json
        if (lower.endsWith(".js")) {
          const p = file.async("string").then((content) => {
            const processed = processJsContent(content, baseTranslations.value, relativePath, {
              warn,
              getTranslationValue,
            });
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
          warn("Для JSON перевода не найден соответствующий HTML в архиве", {
            scope: "JSON",
            code: "JSON_WITHOUT_HTML",
            meta: {
              json: `assets/locales/${baseName}.json`,
              expectedHtml: `${baseName}.html`,
            },
          });
        }
      });

      await Promise.all(filePromises);

      const blob = await newZip.generateAsync({ type: "blob" });
      const baseName = zipName.value.replace(/\.zip$/i, "");
      saveAs(blob, `${baseName}-localized.zip`);

      const totalJsonFiles = jsonMap.size + 1; // +1 за base.json

      success("Готово. Обработка завершена, новый ZIP-файл скачан.", {
        scope: "System",
        code: "DONE",
      });

      info("Итог обработки", {
        scope: "System",
        code: "SUMMARY",
        meta: {
          htmlTotal: htmlBaseNamesInZip.size,
          jsonTotal: totalJsonFiles,
          htmlWithoutJson,
          jsonWithoutHtml,
        },
      });
    } catch (e) {
      console.error(e);
      uiError.value = e?.message || "Произошла ошибка при обработке архива.";
      logError("Критическая ошибка при обработке архива", {
        scope: "System",
        code: "PROCESSING_CRASH",
        meta: { reason: e?.message || String(e) },
      });
    } finally {
      loading.value = false;
    }
  }

  return {
    zipName,
    loading,
    canProcess,
    entries,
    clear,
    uiError,
    setZipFile,
    processArchive,
  };
}
