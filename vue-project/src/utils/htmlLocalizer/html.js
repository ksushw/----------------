function applyAltForImages(doc) {
  const images = doc.querySelectorAll("img");
  images.forEach((img) => {
    img.setAttribute("alt", "img");
  });
}

function checkForRawText(doc, htmlPath, { warn, info, getElementPath }) {
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
    if (parent.closest("[text]")) continue;
    if (!/[A-Za-zА-Яа-я0-9]/.test(trimmed)) continue;

    rawFragments.push({
      text: trimmed,
      selector: getElementPath(parent),
    });
  }

  if (rawFragments.length === 0) return;

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

function removeLocaleScriptTags(doc) {
  const scripts = doc.querySelectorAll("script[src]");

  scripts.forEach((script) => {
    const src = script.getAttribute("src") || "";
    if (/(^|\/)(locale)\.js(\?.*)?$/i.test(src)) {
      script.remove();
    }
  });
}

export function processHtmlContent(htmlString, translations, htmlPath, deps) {
  const { warn, info, getTranslationValue, getElementPath } = deps;

  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlString, "text/html");

  removeLocaleScriptTags(doc);
  checkForRawText(doc, htmlPath, { warn, info, getElementPath });

  applyAltForImages(doc);

  const elements = doc.querySelectorAll("[text]");
  const missingKeysSet = new Set();

  elements.forEach((el) => {
    const key = el.getAttribute("text");
    const value = getTranslationValue(translations, key);

    if (value != null) {
      if (el.tagName.toLowerCase() === "input") el.setAttribute("placeholder", value);
      else el.innerHTML = value;

      el.removeAttribute("text");
    } else {
      warn("Нет перевода для ключа — элемент оставлен без изменений", {
        scope: "HTML",
        file: htmlPath,
        code: "MISSING_TRANSLATION",
        meta: { key },
      });
      missingKeysSet.add(key);
    }
  });

  return "<!DOCTYPE html>\n" + doc.documentElement.outerHTML;
}
