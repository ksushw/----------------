/**
 * merge.js (условно)
 * -----------------------------------------------------------------------------
 * Мини-инструкция по файлу:
 *
 * Этот файл отвечает за объединение переводов:
 *   - base (общие переводы: header/footer/form и т.п.)
 *   - page (переводы конкретной страницы)
 *
 * Результат:
 *   buildTranslations(base, page) возвращает единый объект translations,
 *   где page имеет приоритет над base (если ключи совпадают).
 *
 * Важно:
 * - merge “глубокий” только для обычных объектов (plain objects).
 * - массивы НЕ мерджатся поэлементно — массив из page полностью заменит массив из base.
 * - если base или page отсутствует → возвращается null (сигнал “нельзя локализовать HTML”).
 */

/**
 * isPlainObject(obj)
 * -----------------------------------------------------------------------------
 * Назначение: определить, является ли значение “обычным объектом” вида { ... }.
 *
 * Возвращает true, если:
 *  - obj не null/undefined
 *  - typeof obj === "object"
 *  - obj НЕ массив (Array.isArray(obj) === false)
 *
 * Зачем это нужно:
 * - deepMerge рекурсивно объединяет только такие объекты.
 * - Для строк/чисел/булевых/массивов/undefined используется простая замена.
 *
 * Нюанс:
 * - Эта проверка не отличает, например, Date / Map / Set от “простого объекта”.
 *   Но в переводах обычно только plain-object структура, так что ок.
 */
function isPlainObject(obj) {
  return obj && typeof obj === "object" && !Array.isArray(obj);
}

/**
 * deepMerge(target, source)
 * -----------------------------------------------------------------------------
 * Назначение: “глубокое” объединение двух объектов.
 *
 * Правило приоритета:
 * - source ПЕРЕПИСЫВАЕТ target
 *   (то есть page поверх base).
 *
 * Как работает по шагам:
 *  1) output начинается как поверхностная копия target: { ...target }
 *     Это значит:
 *       - target не мутируется (не изменяется)
 *       - но вложенные объекты пока копируются по ссылке (как у обычного spread)
 *  2) Если source не plain-object → возвращаем output как есть
 *     (то есть “нечего мерджить”)
 *  3) Проходим по всем ключам source:
 *       sourceVal = source[key]
 *       targetVal = output[key]   // то, что уже было в target
 *  4) Если И sourceVal, и targetVal — plain-object:
 *       - вызываем deepMerge рекурсивно
 *       - так мы мерджим вложенные ключи, не теряя структуру base
 *  5) Иначе:
 *       - просто присваиваем output[key] = sourceVal
 *       - это означает “полная замена” значением из source
 *
 * Примеры:
 *  - base: { a: { x: 1, y: 2 } }, page: { a: { y: 9 } }
 *    => { a: { x: 1, y: 9 } }
 *
 *  - base: { a: [1,2,3] }, page: { a: [9] }
 *    => { a: [9] }  // массив заменился целиком
 *
 *  - base: { title: "Base" }, page: { title: "Page" }
 *    => { title: "Page" }
 *
 * Нюанс для новичков:
 * - если в base у ключа объект, а в page у того же ключа строка (или наоборот),
 *   deepMerge НЕ будет пытаться “совместить” типы — page просто заменит значение.
 */
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

/**
 * buildTranslations(base, page)
 * -----------------------------------------------------------------------------
 * Это публичная функция, которую вызывает основной пайплайн локалайзера.
 *
 * Вход:
 *  - base: объект из assets/locales/base.json
 *  - page: объект из assets/locales/<page>.json
 *
 * Выход:
 *  - если base ИЛИ page отсутствует → null
 *    Это специальный сигнал наверх: “переводы не собрать, HTML не локализуем”.
 *  - иначе возвращает deepMerge(base, page)
 *
 * Почему возвращаем null, а не base:
 * - в вашем пайплайне страничный JSON считается обязательным для локализации HTML.
 * - если page нет, лучше сохранить HTML как есть и залогировать предупреждение,
 *   чем частично локализовать (чтобы не было полудохлого результата).
 */
export function buildTranslations(base, page) {
  if (!base || !page) return null;
  return deepMerge(base, page);
}
