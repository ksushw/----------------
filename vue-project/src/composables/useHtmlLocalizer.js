import { ref, computed } from "vue";
import JSZip from "jszip";
import { saveAs } from "file-saver";
import { useLogs } from "@/composables/useLogs";
import { readZipFile, getTranslationValue, getBaseName, getElementPath } from "@/utils/utils.js";
import { buildTranslations } from "@/utils/htmlLocalizer/merge";
import { processHtmlContent } from "@/utils/htmlLocalizer/html";
import { processJsContent } from "@/utils/htmlLocalizer/js";

/**
 * useHtmlLocalizer — composable (Vue) для локализации HTML/JS внутри ZIP-архива.
 *
 * Что делает на высоком уровне:
 * 1) Берёт ZIP, читает из него JSON-переводы из папки assets/locales/
 * 2) Требует обязательный assets/locales/base.json (общие переводы: хедер/футер/форма и т.п.)
 * 3) Для каждого .html файла ищет JSON страницы с таким же baseName (например: about.html -> assets/locales/about.json)
 * 4) Склеивает base + page переводы (buildTranslations)
 * 5) Пропускает HTML через processHtmlContent (подстановка / проставление text= и т.п. — зависит от реализации)
 * 6) Пропускает JS через processJsContent (обычно локализация строк/констант на базе base.json)
 * 7) Собирает новый ZIP без assets/locales/** и без local.js/locale.js и скачивает его
 *
 * Важно: этот composable НЕ правит исходный ZIP-файл, он создаёт новый.
 */
export function useHtmlLocalizer() {
  /**
   * useLogs — единый механизм логирования в UI/консоль.
   * entries — список записей логов (для отображения)
   * clear — очистка логов
   * info/warn/error/success — методы записи логов разных уровней
   *
   * dedupe: true — одинаковые сообщения/события могут дедуплицироваться (чтобы не спамить)
   * max: 5000 — верхний лимит количества записей, чтобы не раздувать память/интерфейс
   */
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

  /**
   * zipFile — выбранный пользователем ZIP-файл (обычно из <input type="file">)
   * zipName — имя файла (для вывода в UI и для имени результата)
   * baseTranslations — объект с переводами из assets/locales/base.json (обязательный)
   * loading — флаг процесса обработки (чтобы отключать кнопки/показывать лоадер)
   */
  const zipFile = ref(null);
  const zipName = ref("");
  const baseTranslations = ref(null);
  const loading = ref(false);

  /**
   * canProcess — computed-флаг: можно ли запускать обработку.
   * Сейчас условие простое: есть ли выбранный zipFile.
   */
  const canProcess = computed(() => !!zipFile.value);

  /**
   * setZipFile(file) — сохраняет выбранный ZIP в состояние composable.
   * Побочные эффекты:
   * - обновляет zipFile
   * - обновляет zipName (для отображения и имени результата)
   */
  function setZipFile(file) {
    zipFile.value = file;
    zipName.value = file?.name || "";
  }

  /**
   * processArchive() — основная функция обработки ZIP.
   *
   * Поток выполнения:
   * A) Сброс baseTranslations
   * B) Проверка, что ZIP выбран
   * C) Чтение ZIP (readZipFile)
   * D) Скан assets/locales/*.json, парсинг JSON, выделение base.json
   * E) Если base.json нет — лог ошибки и ранний выход
   * F) Создание нового ZIP и проход по всем файлам исходного ZIP:
   *    - папки копируются
   *    - assets/locales/** не копируются (исключаются целиком)
   *    - local.js / locale.js не копируются
   *    - .html: пытаемся собрать mergedTranslations (base + page) и обработать HTML
   *    - .js: обрабатываем JS на основе baseTranslations
   *    - остальные файлы копируем как бинарные (arraybuffer)
   * G) Проверка “лишних JSON”: если есть assets/locales/x.json, но x.html отсутствует — warn
   * H) Генерация blob нового ZIP и скачивание file-saver’ом
   * I) Итоговые логи (success + summary)
   * J) Снятие loading в finally
   */

  function normalizeJsonKey(v) {
    if (!v) return "";
    let s = String(v).trim();
    if (!s) return "";
    s = s.split("#")[0].split("?")[0]; // убрать hash/query
    s = s.split("/").pop(); // взять последнее имя
    s = s.replace(/\.json$/i, ""); // убрать .json
    return s.trim();
  }

  function extractJsonPathFromHtml(htmlString) {
    try {
      const doc = new DOMParser().parseFromString(htmlString, "text/html");
      const scripts = doc.querySelectorAll("script[src]");

      for (const s of scripts) {
        const src = s.getAttribute("src") || "";
        // ловим ./assets/locale.js или ./assets/local.js (с любым путём и query)
        if (/(^|\/)(locale|local)\.js(\?.*)?$/i.test(src)) {
          // атрибут в HTML case-insensitive, но на всякий случай читаем оба варианта
          const raw =
            s.getAttribute("jsonPath") ||
            s.getAttribute("jsonpath") ||
            s.getAttribute("data-json-path");

          const key = normalizeJsonKey(raw);
          if (key) return key;
        }
      }
    } catch {
      // если парсер вдруг упал — просто без override
    }
    return null;
  }
  async function processArchive() {
    // При новом запуске гарантируем, что baseTranslations будут перечитаны из текущего ZIP
    baseTranslations.value = null;

    // Защита от запуска без выбранного файла
    if (!zipFile.value) {
      console.log("Нужно выбрать ZIP с HTML и переводами.");
      return;
    }

    // Включаем состояние “обработка идёт”
    loading.value = true;

    try {
      /**
       * readZipFile(file) — утилита, которая читает File/Blob и возвращает экземпляр JSZip
       * (реализация снаружи: обычно JSZip.loadAsync(file)).
       */
      const zip = await readZipFile(zipFile.value);

      /**
       * jsonMap — Map<baseName, translationsObject>
       * Хранит переводы страниц, кроме base.json:
       *   key: baseName (например "about")
       *   value: JSON-объект перевода страницы
       */
      const jsonMap = new Map();

      /**
       * jsonReadPromises — массив промисов чтения/парсинга JSON.
       * Мы собираем их, чтобы потом дождаться Promise.all и работать с полной картиной.
       */
      const jsonReadPromises = [];

      /**
       * Первый проход по ZIP: читаем только JSON из assets/locales/
       * JSZip.forEach вызывается для каждой записи (файл/папка) внутри архива.
       */
      zip.forEach((relativePath, file) => {
        // Папки нам не нужны на этапе чтения JSON
        if (file.dir) return;

        const lower = relativePath.toLowerCase();

        // Берём только *.json
        if (!lower.endsWith(".json")) return;

        // Берём только JSON строго из assets/locales/
        if (!lower.startsWith("assets/locales/")) return;

        /**
         * getBaseName(path) — утилита, которая возвращает имя файла без расширения:
         *   assets/locales/base.json -> "base"
         *   assets/locales/about.json -> "about"
         */
        const baseName = getBaseName(relativePath);

        /**
         * file.async("string") — JSZip читает файл как строку.
         * Затем парсим JSON и раскладываем:
         * - base.json -> baseTranslations
         * - остальные -> jsonMap
         *
         * Любая ошибка JSON.parse логируется как JSON_PARSE_ERROR.
         */
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

      // Дожидаемся, пока ВСЕ JSON прочитаются и распарсятся
      await Promise.all(jsonReadPromises);

      /**
       * base.json обязателен.
       * Без него сборка переводов для страниц либо невозможна, либо будет неполной.
       * Поэтому: логируем ошибку и выходим.
       */
      if (!baseTranslations.value) {
        const msg = 'Не найден обязательный файл переводов "assets/locales/base.json" внутри ZIP.';

        logError(msg, {
          scope: "JSON",
          code: "BASE_JSON_MISSING",
          meta: { expected: "assets/locales/base.json" },
        });

        loading.value = false;
        return;
      }

      /**
       * newZip — новый архив, который мы соберём по результатам обработки.
       * filePromises — промисы копирования/обработки файлов (HTML/JS/бинарные).
       */
      const newZip = new JSZip();
      const filePromises = [];

      /**
       * htmlBaseNamesInZip — Set baseName’ов HTML, которые реально встретились в ZIP.
       * Нужно, чтобы потом понять, есть ли “лишние” JSON переводы без HTML.
       */
      const htmlBaseNamesInZip = new Set();
      const jsonKeysUsedByHtml = new Set();

      // Счётчики для итоговой статистики
      let htmlWithoutJson = 0; // сколько HTML обработать не смогли из-за отсутствия/проблем переводов
      let jsonWithoutHtml = 0; // сколько JSON есть, но соответствующего HTML нет

      /**
       * Второй проход по ZIP: строим новый архив.
       * Здесь решается судьба каждого файла:
       * - копировать как есть
       * - обработать и записать обработанную версию
       * - пропустить (не включать в новый ZIP)
       */
      zip.forEach((relativePath, file) => {
        const lower = relativePath.toLowerCase();
        const fileNameOnly = relativePath.split("/").pop().toLowerCase();

        /**
         * Полностью исключаем папку с переводами из результирующего ZIP.
         */
        if (
          lower === "assets/locales" ||
          lower === "assets/locales/" ||
          lower.startsWith("assets/locales/")
        ) {
          return;
        }

        /**
         Исключаем local.js/locale.js
         */
        if (fileNameOnly === "local.js" || fileNameOnly === "locale.js") {
          return;
        }

        /**
         * Если это папка — создаём папку в новом ZIP с тем же путём.
         */
        if (file.dir) {
          newZip.folder(relativePath);
          return;
        }

        /**
         * HTML-файлы:
         * - вычисляем baseName (about.html -> "about")
         * - берём переводы страницы из jsonMap
         * - склеиваем base + page (buildTranslations)
         * - если не получилось — сохраняем HTML как есть и пишем warn
         * - если получилось — прогоняем через processHtmlContent и сохраняем результат
         */
        if (lower.endsWith(".html")) {
          const htmlBase = getBaseName(relativePath);
          htmlBaseNamesInZip.add(htmlBase);

          const p = file.async("string").then((content) => {
            const overrideKey = extractJsonPathFromHtml(content); // NEW
            const pageKey = overrideKey || htmlBase; // NEW

            jsonKeysUsedByHtml.add(pageKey); // NEW

            const pageTranslations = jsonMap.get(pageKey);
            const mergedTranslations = buildTranslations(baseTranslations.value, pageTranslations);

            if (!mergedTranslations) {
              htmlWithoutJson++;

              if (!pageTranslations) {
                warn(
                  "Не найден обязательный файл переводов страницы — HTML сохранён без изменений",
                  {
                    scope: "HTML",
                    file: relativePath,
                    code: "PAGE_JSON_MISSING",
                    meta: {
                      expected: `assets/locales/${pageKey}.json`,
                      htmlBase,
                      overrideKey: overrideKey || null,
                    },
                  },
                );
              } else {
                warn("Не удалось собрать переводы (base + page) — HTML сохранён без изменений", {
                  scope: "HTML",
                  file: relativePath,
                  code: "TRANSLATIONS_MERGE_FAILED",
                  meta: {
                    pageJson: `assets/locales/${pageKey}.json`,
                    htmlBase,
                    overrideKey: overrideKey || null,
                  },
                });
              }

              newZip.file(relativePath, content);
              return;
            }

            const processed = processHtmlContent(content, mergedTranslations, relativePath, {
              warn,
              info,
              getTranslationValue,
              getElementPath,
            });

            newZip.file(relativePath, processed);
          });

          filePromises.push(p);
          return;
        }

        /**
         * JS-файлы:
         * - читаем как строку
         * - прогоняем через processJsContent на основе baseTranslations
         * - пишем обработанный JS в новый ZIP
         */
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

        /**
         * Все остальные файлы (картинки, шрифты, css, и т.д.) копируем “как есть” бинарно.
         * arraybuffer нужен, чтобы не повредить бинарные данные.
         */
        const p = file.async("arraybuffer").then((content) => {
          newZip.file(relativePath, content);
        });
        filePromises.push(p);
      });

      /**
       * Проверка “JSON без HTML”:
       * Если в assets/locales/ есть перевод для страницы, но самой страницы (.html) в архиве нет —
       * это не критично, но подозрительно (лишний файл/ошибка именования/не тот архив).
       */

      // Дожидаемся, пока ВСЕ файлы будут скопированы/обработаны и записаны в newZip
      await Promise.all(filePromises);
jsonMap.forEach((_, baseName) => {
  if (!jsonKeysUsedByHtml.has(baseName)) {
    jsonWithoutHtml++;
    warn("Для JSON перевода не найден соответствующий HTML в архиве", {
      scope: "JSON",
      code: "JSON_WITHOUT_HTML",
      meta: {
        json: `assets/locales/${baseName}.json`,
      },
    });
  }
});

      /**
       * newZip.generateAsync({ type: "blob" }) — генерирует итоговый ZIP как Blob (для браузера).
       * Далее saveAs(blob, filename) инициирует скачивание.
       */
      const blob = await newZip.generateAsync({ type: "blob" });

      // Имя результата: исходное имя zip без .zip + суффикс "-localized.zip"
      const baseName = zipName.value.replace(/\.zip$/i, "");
      saveAs(blob, `${baseName}-localized.zip`);

      // Общее число JSON: все page-json + 1 (base.json)
      const totalJsonFiles = jsonMap.size + 1;

      // Успешное завершение
      success("Готово. Обработка завершена, новый ZIP-файл скачан.", {
        scope: "System",
        code: "DONE",
      });

      // Сводка — удобно для UI и быстрой диагностики “что пропустилось и почему”
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
      /**
       * Любая непредвиденная ошибка (чтение ZIP, генерация, обработчики и т.п.)
       * попадает сюда. Пишем в консоль и в лог-систему как критическую.
       */
      console.error(`Произошла ошибка при обработке архива: ${e}`);
      logError("Критическая ошибка при обработке архива", {
        scope: "System",
        code: "PROCESSING_CRASH",
        meta: { reason: e?.message || String(e) },
      });
    } finally {
      // Гарантированно выключаем loading, даже если было исключение
      loading.value = false;
    }
  }

  /**
   * Возвращаем наружу публичный API composable.
   * Это то, что будет использовать компонент:
   * - zipName/loading/canProcess — для UI
   * - entries/clear — для отображения и управления логами
   * - setZipFile/processArchive — основные действия пользователя
   */
  return {
    zipName,
    loading,
    canProcess,
    entries,
    clear,
    setZipFile,
    processArchive,
  };
}
