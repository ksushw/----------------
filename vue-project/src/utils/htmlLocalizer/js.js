export function processJsContent(content, baseTranslations, fileName, deps) {
  const { warn, getTranslationValue } = deps;

  if (!baseTranslations) {
    warn("base.json не найден — JS сохранён без изменений", {
      scope: "JS",
      file: fileName,
      code: "NO_BASE_JSON",
    });
    return content;
  }

  const regex = /__t\(\s*(['"`])([^'"`]+)\1\s*(?:,[^)]+)?\)/g;

  return content.replace(regex, (match, _quote, keyPath) => {
    const value = getTranslationValue(baseTranslations, keyPath);

    if (value == null) {
      warn("Не найден перевод в base.json — оставляю __t(...) как есть", {
        scope: "JS",
        file: fileName,
        code: "MISSING_TRANSLATION_BASE",
        meta: { key: keyPath },
      });

      return match;
    }

    const escaped = String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");

    return `"${escaped}"`;
  });
}
