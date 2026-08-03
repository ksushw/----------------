/**
 * processJsContent.js (условно)
 * -----------------------------------------------------------------------------
 * Мини-инструкция по файлу:
 *
 * Этот обработчик JS “запекает” переводы прямо в код.
 * Он ищет вызовы вида:
 *   __t("some.key")
 *   __t('some.key')
 *   __t(`some.key`)
 *
 * И заменяет весь вызов __t(...) на строковый литерал с переводом:
 *   "__Переведённый текст__"
 *
 * Источник переводов: ТОЛЬКО baseTranslations (то есть assets/locales/base.json).
 * Если base.json нет — JS возвращается без изменений.
 *
 * Важно:
 * - Значение экранируется для JS-строки в двойных кавычках (", \, \n).
 * - Если перевод не найден, вызов __t(...) оставляется как есть, и пишется warn.
 */

/**
 * processJsContent(content, baseTranslations, fileName, deps)
 * -----------------------------------------------------------------------------
 * Вход:
 *  - content: исходный JS-код (строка)
 *  - baseTranslations: объект переводов из base.json
 *  - fileName: имя/путь JS-файла (для логов)
 *  - deps:
 *      warn(...) — лог предупреждений в UI
 *      getTranslationValue(obj, keyPath) — достаёт перевод по ключу (может быть вложенным)
 *
 * Выход:
 *  - новая строка JS-кода:
 *      - либо с подставленными переводами вместо __t(...)
 *      - либо исходная (если base.json отсутствует)
 *
 * Важная идея:
 * - Мы не “исполняем” JS и не парсим AST, а просто делаем текстовую замену по regex.
 * - Поэтому формат __t(...) должен соответствовать регулярке, иначе замены не будет.
 */

import { lintUserJs } from "@/utils/htmlLocalizer/lint.js";
import { hasTranslatableLetters, stripShortcodes } from "@/utils/utils.js";
export function processJsContent(content, baseTranslations, fileName, deps) {
  const { warn, getTranslationValue } = deps;
  /**
   * Защита от отсутствия base.json:
   * - В основном пайплайне base.json обязателен, но этот обработчик всё равно безопасный:
   *   если baseTranslations не передали (null/undefined), мы:
   *     1) пишем предупреждение,
   *     2) возвращаем JS как есть.
   */
  lintUserJs(content, fileName, warn);
  if (!baseTranslations) {
    warn("base.json не найден — JS сохранён без изменений", {
      scope: "JS",
      file: fileName,
      code: "NO_BASE_JSON",
    });
    return content;
  }

  /**
   * Регулярное выражение для поиска вызовов __t(...)
   *
   * Что ловим:
   *   __t(  'ключ'  )
   *   __t("ключ")
   *   __t(`ключ`)
   *   __t("ключ", что-то ещё)
   *
   * Разбор regex по частям:
   *  /__t\(\s*(['"`])([^'"`]+)\1\s*(?:,[^)]+)?\)/g
   *
   *  __t\(             - буквально "__t(" (скобку экранируем)
   *  \s*               - пробелы после "("
   *  (['"`])           - Группа 1: какая кавычка использована (' или " или `)
   *  ([^'"`]+)         - Группа 2: сам ключ (любые символы, кроме кавычек)
   *  \1                - закрывающая кавычка того же типа, что и открывающая (ссылка на группу 1)
   *  \s*               - пробелы после ключа
   *  (?:,[^)]+)?       - НЕобязательный второй аргумент:
   *                       начинается с запятой и берёт любые символы до ')'
   *  \)                - закрывающая скобка
   *  g                 - глобальный поиск по всей строке
   *
   * Ограничения regex (важно новичкам):
   * - ключ должен быть прямо строковым литералом, переменные не подойдут:
   *     __t(key)              // НЕ сработает
   * - в ключе не должно быть кавычек/бектиков
   * - второй аргумент не анализируется, просто “проглатывается”
   * - если внутри второго аргумента будут скобки/")" — эта регулярка может не совпасть как ожидается
   */
  const regex = /__t\(\s*(['"`])([^'"`]+)\1\s*(?:,[^)]+)?\)/g;

  /**
   * replace(regex, callback)
   * -----------------------------------------------------------------------------
   * Для каждого совпадения:
   *  - match: полная строка совпадения, например: __t("header.title")
   * Возвращаем строку, на которую заменяем совпадение.
   */
  content = content.replace(regex, (match, _quote, keyPath) => {
    /**
     * Ищем перевод по ключу в baseTranslations.
     * getTranslationValue может поддерживать вложенные пути типа "a.b.c".
     */
    const value = getTranslationValue(baseTranslations, keyPath);

    /**
     * Если перевод не найден:
     * - логируем предупреждение
     * - оставляем исходный вызов __t(...) нетронутым
     */
    if (value == null) {
      warn("Не найден перевод в base.json — оставляю __t(...) как есть", {
        scope: "JS",
        file: fileName,
        code: "MISSING_TRANSLATION_BASE",
        meta: { key: keyPath },
      });

      return match;
    }

    /**
     * Экранирование перевода под JS-строку в ДВОЙНЫХ кавычках.
     *
     * Что экранируем:
     * - "\"  -> "\\"
     * - """  -> "\""
     * - перенос строки -> "\n"
     *
     * Почему именно так:
     * - мы всегда возвращаем строку вида `"...."` (двойные кавычки),
     *   значит внутри текста нельзя оставить неэкранированные "
     */
    const escaped = String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");

    /**
     * Возвращаем готовый JS-литерал в двойных кавычках.
     * Пример:
     *   было:  __t("header.title")
     *   стало: "Welcome"
     */
    return `"${escaped}"`;
  });

  content = processJsTemplateLiterals(content, baseTranslations, fileName, deps);

  return content;
}

function checkRawTextInJsTemplate(wrapper, fileName, warn) {
  const walker = document.createTreeWalker(wrapper, NodeFilter.SHOW_TEXT, null);
  let node;
  while ((node = walker.nextNode())) {
    const trimmed = (node.nodeValue || '').trim();
    if (!trimmed) continue;
    const parent = node.parentElement;
    if (!parent) continue;
    const tag = parent.tagName.toLowerCase();
    if (tag === 'script' || tag === 'style') continue;
    if (parent.closest('[text]')) continue;
    if (!hasTranslatableLetters(stripShortcodes(trimmed))) continue;
    warn('Есть сырой текст в JS-шаблоне, нужно перенести в JSON', {
      scope: 'JS',
      file: fileName,
      code: 'RAW_TEXT',
      meta: { text: trimmed },
    });
  }
}

function processJsTemplateLiterals(content, baseTranslations, fileName, deps) {
  const { warn, getTranslationValue } = deps;

  const interpolations = [];
  let safe = '';
  let i = 0;
  while (i < content.length) {
    if (content[i] === '$' && content[i + 1] === '{') {
      let depth = 1, j = i + 2;
      while (j < content.length && depth > 0) {
        if (content[j] === '{') depth++;
        else if (content[j] === '}') depth--;
        j++;
      }
      interpolations.push(content.slice(i, j));
      safe += `￾I${interpolations.length - 1}￾`;
      i = j;
    } else {
      safe += content[i++];
    }
  }

  const processed = safe.replace(/`([\s\S]*?)`/g, (match, body) => {
    if (!body.includes('text="')) return match;

    // Проверяем сырой текст до сокрытия SVG — иначе плейсхолдеры ￾S0￾ сами попадут в лог
    const checkWrapper = document.createElement('div');
    checkWrapper.innerHTML = body;
    checkRawTextInJsTemplate(checkWrapper, fileName, warn);

    const svgBlocks = [];
    const bodySafe = body.replace(/<svg[\s\S]*?<\/svg>/gi, (m) => {
      svgBlocks.push(m);
      return `￾S${svgBlocks.length - 1}￾`;
    });

    const wrapper = document.createElement('div');
    wrapper.innerHTML = bodySafe;

    const elements = wrapper.querySelectorAll('[text]');
    if (!elements.length) return match;

    elements.forEach((el) => {
      const key = el.getAttribute('text');
      const value = getTranslationValue(baseTranslations, key);

      if (value != null) {
        el.tagName.toLowerCase() === 'input'
          ? el.setAttribute('placeholder', value)
          : (el.innerHTML = value);
        el.removeAttribute('text');
      } else {
        warn('Нет перевода для ключа в JS-шаблоне', {
          scope: 'JS', file: fileName,
          code: 'MISSING_TRANSLATION', meta: { key },
        });
      }
    });

    const result = wrapper.innerHTML.replace(/￾S(\d+)￾/g, (_, i) => svgBlocks[+i]);

    return '`' + result + '`';
  });

  return processed.replace(/￾I(\d+)￾/g, (_, i) => interpolations[+i]);
}
