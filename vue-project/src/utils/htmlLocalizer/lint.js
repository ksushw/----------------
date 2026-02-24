import * as eslint from "eslint-linter-browserify";
import globals from "globals";
import noHardcodedDomText from "../lint-rules.js";

const linter = new eslint.Linter({ configType: "flat" });

// виртуальный плагин
const localPlugin = {
  rules: {
    "no-hardcoded-dom-text": noHardcodedDomText,
  },
};

function getLine(code, line) {
  const lines = String(code).split(/\r?\n/);
  return lines[(line || 1) - 1] || "";
}

function extractQuotedValue(message) {
  // вытаскиваем "...." из сообщения правила, если есть
  const m = String(message).match(/"([^"]*)"/);
  return m ? m[1] : "";
}

export function lintUserJs(code, filename = "user.js", warn) {
  const config = [
    {
      languageOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        globals: globals.browser,
      },
      plugins: { local: localPlugin },
      rules: {
        // ВАЖНО: 1 (warn), а не "warn"
        "local/no-hardcoded-dom-text": [1, { tFunction: "__t", allowStaticChunks: true }],
      },
    },
  ];

  const messages = linter.verify(code, config, { filename });
  if (typeof warn === "function") {
    for (const m of messages) {
      if (m.ruleId !== "local/no-hardcoded-dom-text") continue;

      const lineText = getLine(code, m.line).trim();
      const hardValue = extractQuotedValue(m.message) || lineText;
      const isPlaceholder = /placeholder/i.test(m.message);
      const codeId = isPlaceholder ? "HARDCODED_PLACEHOLDER" : "HARDCODED_JS_TEXT";
      warn(m.message, {
        scope: "JS",
        file: filename,
        code: codeId,
        meta: {
          key: hardValue,
          path: `L${m.line}:${m.column}`,
        },
      });
    }
  }
  return messages;
}
