function isPlainObject(obj) {
  return obj && typeof obj === "object" && !Array.isArray(obj);
}

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

export function buildTranslations(base, page) {
  if (!base || !page) return null;
  return deepMerge(base, page);
}
