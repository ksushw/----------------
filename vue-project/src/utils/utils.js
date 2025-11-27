// чтение JSON файла
import JSZip from "jszip";

function readJsonFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const obj = JSON.parse(reader.result);
        resolve(obj);
      } catch (e) {
        reject(new Error("Не удалось распарсить JSON", e));
      }
    };
    reader.onerror = () => reject(new Error("Ошибка чтения JSON файла"));
    reader.readAsText(file, "utf-8");
  });
}

// чтение ZIP файла
function readZipFile(file) {
  const zip = new JSZip();
  return zip.loadAsync(file);
}

// универсалка для доступа по пути "a.b.c"
const propByPath = (object, path) =>
  path.split('.').reduce((acc, cur) => acc?.[cur], object);

// получение перевода по ключу, поддержка вложенных путей "a.b.c"
function getTranslationValue(translations, key) {
  if (!key) return null;

  // если объект с обёрткой translation — разворачиваем
  const root = translations?.translation ?? translations;
  if (!root) return null;

  const value = propByPath(root, key);
  return value ?? null; // приводим undefined → null, как у тебя раньше
}


// получение имени файла
function getBaseName(path) {
  const fileName = path.split(/[\\/]/).pop() || "";
  return fileName.replace(/\.[^.]+$/, "");
}
export { readJsonFile, readZipFile, getTranslationValue, getBaseName };
