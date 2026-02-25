/**
 * ФАЙЛ: processHtmlContent.js (условно)
 * -----------------------------------------------------------------------------
 * Мини-инструкция (что делает файл):
 *
 * Этот файл — HTML-процессор локализации.
 * Он получает:
 *   1) исходную HTML-строку (htmlString),
 *   2) объект переводов (translations),
 *   3) путь/имя HTML файла (htmlPath) — только для логов,
 *   4) зависимости deps (warn/info/getTranslationValue/getElementPath).
 *
 * И делает 4 вещи:
 *   A) Удаляет <script src=".../locale.js"> из HTML, чтобы не мешал/не конфликтовал.
 *   B) Проверяет наличие "сырого текста" в HTML (текст без атрибута [text]) и логирует предупреждения.
 *   C) Всем <img> ставит alt="img" (чтобы не было пустого alt и валидаторы не ругались).
 *   D) Находит все элементы с атрибутом [text], берёт ключ из text="...",
 *      достаёт перевод по ключу и:
 *        - если это <input> → ставит placeholder
 *        - иначе → заменяет innerHTML
 *      затем удаляет атрибут text (чтобы в финальном HTML не оставалось "служебной разметки").
 *
 * На выходе возвращает строку готового HTML.
 *
 * Важно про формат переводов:
 * - translations может быть вложенным объектом.
 * - key из атрибута [text] может быть "путём" (например "header.title"),
 *   а getTranslationValue(translations, key) знает, как достать значение по этому пути.
 *
 * Важно про безопасность:
 * - Здесь используется el.innerHTML = value, то есть перевод может содержать HTML-теги.
 *   Это сделано намеренно (например, <br>, <strong> и т.п. в переводе).
 */

/**
 * applyAltForImages(doc)
 * -----------------------------------------------------------------------------
 * Назначение: дать всем картинкам alt, чтобы:
 *   - не было <img alt=""> или вообще без alt (линтеры/валидаторы ругаются),
 *   - верстка выглядела аккуратнее по требованиям доступности.
 *
 * Как работает:
 *   - берёт ВСЕ <img> внутри документа
 *   - каждому ставит alt="img"
 *
 * Ограничения/нюансы:
 *   - если у картинки уже был осмысленный alt — он будет перезаписан.
 *     (То есть это "жёсткое" правило, а не аккуратное "если alt отсутствует".)
 */
function applyAltForImages(doc) {
  const images = doc.querySelectorAll("img");
  images.forEach((img) => {
    img.setAttribute("alt", "img");
  });
}

/**
 * checkForRawText(doc, htmlPath, { warn, info, getElementPath })
 * -----------------------------------------------------------------------------
 * Назначение: найти “сырой” (не локализованный) текст в HTML.
 *
 * Что считается “сырым текстом” в этой логике:
 *   - это текстовые узлы (не теги), которые содержат буквы/цифры,
 *   - и при этом НЕ находятся внутри элемента с атрибутом [text].
 *
 * Зачем это нужно:
 *   - вы переносите тексты в JSON и оставляете в HTML только ссылку key через text="..."
 *   - если где-то забыли вынести строку, этот чек подсветит места.
 *
 * Как это реализовано:
 *   1) Выбираем корень обхода: doc.body (если есть) иначе doc.
 *   2) Создаём TreeWalker, который проходит только по TEXT узлам:
 *        NodeFilter.SHOW_TEXT
 *   3) Проходим все текстовые узлы и отбрасываем "мусор":
 *        - пустые/пробельные
 *        - без parentElement (на всякий)
 *        - внутри script/style/noscript (там текст не локализуем как обычный)
 *        - внутри любого элемента, у которого есть ближайший предок с [text]
 *          (т.е. текст уже “контролируется” переводом)
 *        - без букв/цифр (фильтр на реальные символы)
 *   4) Каждый найденный фрагмент сохраняем:
 *        - text: сам текст
 *        - selector: путь элемента (getElementPath(parent)), чтобы быстро найти в HTML
 *   5) Логируем максимум 20 фрагментов через warn(...)
 *   6) Если фрагментов больше 20 — пишем info(...) что показано не всё.
 *
 * Почему лимит:
 *   - чтобы не заспамить лог UI, особенно если HTML большой.
 */
import { hasTranslatableLetters } from "@/utils/utils.js";
function checkForRawText(doc, htmlPath, { warn, info, getElementPath }) {
  const root = doc.body || doc;
  if (!root) return;

  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  const rawFragments = [];

  let node;
  while ((node = walker.nextNode())) {
    const text = node.nodeValue || "";
    const trimmed = text.trim();

    // Пропускаем пустой текст (пробелы/переносы строк).
    if (!trimmed) continue;

    // Берём родительский HTML-элемент, чтобы:
    //  - проверить теги (script/style)
    //  - построить selector (через getElementPath)
    const parent = node.parentElement;
    if (!parent) continue;

    const tag = parent.tagName.toLowerCase();

    // Не анализируем текст внутри <script>, <style>, <noscript>:
    // там могут быть JS/CSS/шаблоны, это не “тексты интерфейса”.
    if (tag === "script" || tag === "style" || tag === "noscript") continue;

    // Если этот текст находится внутри элемента с атрибутом [text],
    // значит он уже должен приходить из JSON (или хотя бы помечен).
    if (parent.closest("[text]")) continue;

    // Фильтр "похож на реальный текст":
    // ищем буквы/цифры (латиница, кириллица, цифры).
    // Это отсекает, например, “—”, “•”, “…” и т.п.
   if (!hasTranslatableLetters(trimmed)) continue;
    rawFragments.push({
      text: trimmed,
      selector: getElementPath(parent),
    });
  }

  // Если сырого текста нет — выходим тихо.
  if (rawFragments.length === 0) return;

  // Показываем только первые 20 — чтобы лог был читабельным.
  const limit = 20;

  rawFragments.slice(0, limit).forEach((frag) => {
    warn("Есть сырой текст, нужно перенести в JSON", {
      scope: "HTML",
      file: htmlPath,
      code: "RAW_TEXT",
      meta: {
        text: frag.text,
        selector: frag.selector,
      },
    });
  });

  // Если нашли больше 20 фрагментов — информируем, что лог урезан.
  if (rawFragments.length > limit) {
    info(`[Проверка текста] Показаны не все фрагменты (всего ${rawFragments.length})`, {
      scope: "HTML",
      file: htmlPath,
      code: "RAW_TEXT_LIMIT",
      meta: {
        shown: limit,
        total: rawFragments.length,
      },
    });
  }
}

/**
 * removeLocaleScriptTags(doc)
 * -----------------------------------------------------------------------------
 * Назначение: убрать подключение locale.js из HTML.
 *
 * Почему:
 * - В пайплайне локализации вы часто хотите “запечь” локализацию в HTML,
 *   и не оставлять старый runtime-скрипт локализации, который:
 *     - может повторно что-то заменять,
 *     - может конфликтовать,
 *     - может быть не нужен в результате.
 *
 * Как работает:
 *  1) Берём все <script> у которых есть src (внешние файлы)
 *  2) Смотрим src и если он заканчивается на locale.js (с любым путём и query-string),
 *     удаляем тег целиком.
 *
 * Регулярка:
 *  - (^|\/)     : начало строки или слэш перед именем файла
 *  - (locale)\.js : сам файл locale.js
 *  - (\?.*)?    : возможные query параметры ?v=123
 *  - i          : без учета регистра
 */
function removeLocaleScriptTags(doc) {
  const scripts = doc.querySelectorAll("script[src]");

  scripts.forEach((script) => {
    // src может быть с ?query и (реже) с #hash — hash тоже убираем, чтобы матчить конец файла
    const src = (script.getAttribute("src") || "").split("#")[0];

    // 1) удаляем locale/local
    if (/(^|\/)(locale|local)\.js(\?.*)?$/i.test(src)) {
      script.remove();
      return;
    }

    // 2) удаляем short-domain (вот твой кейс)
    if (/(^|\/)short-domain\.js(\?.*)?$/i.test(src)) {
      script.remove();
      return;
    }
  });
}

/**
 * processHtmlContent(htmlString, translations, htmlPath, deps)
 * -----------------------------------------------------------------------------
 * Главная функция обработки HTML.
 *
 * Вход:
 *  - htmlString: исходный HTML (строка)
 *  - translations: объект переводов (base + page уже объединены снаружи)
 *  - htmlPath: путь файла внутри zip (для логов)
 *  - deps:
 *      warn/info: функции логирования
 *      getTranslationValue(translations, key): достаёт перевод по ключу (в т.ч. вложенному)
 *      getElementPath(element): строит путь элемента для логов
 *
 * Выход:
 *  - строка готового HTML, в начало добавляется "<!DOCTYPE html>\n"
 *
 * Порядок действий (важно понимать, что именно в какой последовательности происходит):
 *  1) Парсим HTML строку в DOM (DOMParser)
 *  2) Удаляем locale.js (removeLocaleScriptTags)
 *  3) Проверяем сырой текст и логируем места (checkForRawText)
 *  4) Ставим всем img alt="img" (applyAltForImages)
 *  5) Находим ВСЕ элементы с атрибутом [text]
 *  6) Для каждого элемента:
 *       - берём key из атрибута text="..."
 *       - получаем value из translations через getTranslationValue
 *       - если перевод найден:
 *            * если это input → placeholder = value
 *            * иначе → innerHTML = value
 *            * удаляем атрибут text (он служебный)
 *       - если перевода нет:
 *            * warn (чтобы знать, какой ключ не завезли)
 *            * сохраняем ключ в missingKeysSet (на будущее/отладку)
 *  7) Возвращаем HTML строку документа целиком
 *
 * Нюанс:
 * - missingKeysSet сейчас собирается, но в этом коде дальше не используется.
 *   Обычно это задел на:
 *     - вывести список уникальных missing keys одним сообщением,
 *     - или прокинуть статистику наверх.
 */
export function processHtmlContent(htmlString, translations, htmlPath, deps) {
  const { warn, info, getTranslationValue, getElementPath } = deps;

  // DOMParser — браузерный API: превращает HTML строку в DOM документ.
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlString, "text/html");

  // Шаг 1: убираем locale.js
  removeLocaleScriptTags(doc);

  // Шаг 2: находим “сырой текст” (без [text]) и предупреждаем в логах
  checkForRawText(doc, htmlPath, { warn, info, getElementPath });

  // Шаг 3: ставим alt всем картинкам
  applyAltForImages(doc);

  // Ищем все элементы с атрибутом [text] — это ваши "якоря локализации"
  // Пример: <h1 text="hero.title"></h1>
  const elements = doc.querySelectorAll("[text]");

  // Сюда собираются ключи, которых не было в translations (уникально).
  const missingKeysSet = new Set();

  elements.forEach((el) => {
    // Ключ лежит в атрибуте text="..."
    const key = el.getAttribute("text");

    // Пытаемся достать значение перевода по ключу (в том числе вложенному).
    const value = getTranslationValue(translations, key);

    if (value != null) {
      // Особый случай: <input> — у него текст обычно в placeholder.
      // Для всех остальных элементов вставляем как HTML (innerHTML).
      if (el.tagName.toLowerCase() === "input") el.setAttribute("placeholder", value);
      else el.innerHTML = value;

      // Атрибут text — служебный. После подстановки он не нужен → удаляем.
      el.removeAttribute("text");
    } else {
      // Нет перевода → элемент оставляем как был, но логируем, чтобы исправить JSON.
      warn("Нет перевода для ключа — элемент оставлен без изменений", {
        scope: "HTML",
        file: htmlPath,
        code: "MISSING_TRANSLATION",
        meta: { key },
      });
      missingKeysSet.add(key);
    }
  });

  // Возвращаем полный HTML документа.
  // Добавляем <!DOCTYPE html> явно, чтобы итоговый файл был корректным HTML-документом.
  return "<!DOCTYPE html>\n" + doc.documentElement.outerHTML;
}
