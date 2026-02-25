import { hasTranslatableLetters } from "@/utils/utils.js";

const DEFAULTS = {
  tFunction: "__t",
  sinks: new Set(["innerHTML", "textContent", "value", "placeholder"]),
  allowStaticChunks: true,
};

function isCallToT(node, tName) {
  return (
    node &&
    node.type === "CallExpression" &&
    node.callee &&
    node.callee.type === "Identifier" &&
    node.callee.name === tName
  );
}

function getMemberPropName(mem) {
  if (!mem || mem.type !== "MemberExpression") return null;

  if (!mem.computed && mem.property?.type === "Identifier") return mem.property.name;
  if (mem.computed && mem.property?.type === "Literal") return String(mem.property.value);

  return null;
}

function getSourceCodeCompat(context) {
  return context.sourceCode || context.getSourceCode?.() || null;
}

function findVariable(scope, name) {
  for (let s = scope; s; s = s.upper) {
    const v = s.variables?.find((vv) => vv.name === name);
    if (v) return v;
  }
  return null;
}

function getScopeCompat(context, node) {
  const sc = getSourceCodeCompat(context);
  if (sc?.getScope) return sc.getScope(node); // ESLint v9+
  if (context.getScope) return context.getScope(); // ESLint <= v8
  return null;
}

function resolveIdentifierDefNode(context, idNode) {
  const scope = getScopeCompat(context, idNode);
  if (!scope) return null;

  const variable = findVariable(scope, idNode.name);
  if (!variable) return null;

  // VariableDeclarator: const x = <init>
  const varDef = variable.defs?.find(
    (d) => d.type === "Variable" && d.node?.type === "VariableDeclarator",
  );
  if (varDef) return varDef.node.init || null;

  // FunctionDeclaration: function x() {}
  const fnDef = variable.defs?.find(
    (d) => d.type === "FunctionName" && d.node?.type === "FunctionDeclaration",
  );
  if (fnDef) return fnDef.node;

  return null;
}

function isAllowedStaticChunk(text) {
  if (text == null) return true;
  if (text.trim() === "") return true;
  return !hasTranslatableLetters(text);
}

function isBlankString(v) {
  return typeof v === "string" && v.trim() === "";
}

function extractHardcodedText(node, context) {
  if (!node) return "";

  if (node.type === "Literal" && typeof node.value === "string") return node.value;

  if (node.type === "TemplateLiteral") {
    return (node.quasis || []).map((q) => q?.value?.raw ?? "").join("");
  }

  const sc = getSourceCodeCompat(context);
  return sc?.getText ? sc.getText(node) : "";
}

// ---------- NEW: collect returns from function bodies ----------
function collectReturnArgs(fnNode) {
  const out = [];
  const visited = new Set();

  function walk(n) {
    if (!n || typeof n !== "object") return;
    if (visited.has(n)) return;
    visited.add(n);

    if (n.type === "ReturnStatement") {
      out.push(n.argument || null);
      return;
    }

    for (const k of Object.keys(n)) {
      const v = n[k];
      if (Array.isArray(v)) {
        for (const it of v) walk(it);
      } else if (v && typeof v === "object" && typeof v.type === "string") {
        walk(v);
      }
    }
  }

  // ArrowFunctionExpression может иметь body-Expression или body-BlockStatement
  if (fnNode.type === "ArrowFunctionExpression") {
    if (fnNode.body?.type === "BlockStatement") walk(fnNode.body);
    else out.push(fnNode.body || null); // expression-body
    return out;
  }

  // FunctionExpression / FunctionDeclaration
  if (fnNode.body?.type === "BlockStatement") walk(fnNode.body);
  return out;
}

function mergeResults(list) {
  const hardcodedNodes = [];
  let sawUnknown = false;
  let allSafe = true;

  for (const r of list) {
    if (!r) continue;
    if (r.status === "hardcoded") {
      allSafe = false;
      if (Array.isArray(r.nodes)) hardcodedNodes.push(...r.nodes);
    } else if (r.status === "unknown") {
      allSafe = false;
      sawUnknown = true;
    } else if (r.status !== "safe") {
      allSafe = false;
      sawUnknown = true;
    }
  }

  if (hardcodedNodes.length) {
    // дедуп по ссылкам (обычно достаточно)
    return { status: "hardcoded", nodes: Array.from(new Set(hardcodedNodes)) };
  }
  if (allSafe) return { status: "safe", nodes: [] };
  if (sawUnknown) return { status: "unknown", nodes: [] };
  return { status: "unknown", nodes: [] };
}

/**
 * analyzeExpr returns:
 * - { status: "safe", nodes: [] }
 * - { status: "hardcoded", nodes: [<nodes to report>] }
 * - { status: "unknown", nodes: [] }
 */
function analyzeExpr(node, context, opts, seen = new Set()) {
  if (!node) return { status: "unknown", nodes: [] };

  if (isCallToT(node, opts.tFunction)) return { status: "safe", nodes: [] };

  switch (node.type) {
    case "Literal": {
      if (typeof node.value === "string") {
        if (isBlankString(node.value)) return { status: "safe", nodes: [] };

        if (opts.allowStaticChunks && isAllowedStaticChunk(node.value)) {
          return { status: "safe", nodes: [] };
        }
        return { status: "hardcoded", nodes: [node] };
      }
      return { status: "unknown", nodes: [] };
    }

    case "TemplateLiteral": {
      // если есть "плохой" статический текст — репортим на весь шаблон
      for (const q of node.quasis || []) {
        const raw = q?.value?.raw ?? "";
        if (!opts.allowStaticChunks) {
          if (raw.trim() !== "") return { status: "hardcoded", nodes: [node] };
        } else {
          if (!isAllowedStaticChunk(raw)) return { status: "hardcoded", nodes: [node] };
        }
      }

      // выражения внутри `${...}`
      const parts = [];
      for (const ex of node.expressions || []) {
        parts.push(analyzeExpr(ex, context, opts, seen));
      }
      // если все safe — safe, если где-то hardcoded — hardcoded, иначе unknown
      return mergeResults(parts.length ? parts : [{ status: "safe", nodes: [] }]);
    }

    case "BinaryExpression": {
      if (node.operator !== "+") return { status: "unknown", nodes: [] };

      const l = analyzeExpr(node.left, context, opts, seen);
      const r = analyzeExpr(node.right, context, opts, seen);
      return mergeResults([l, r]);
    }

    case "ConditionalExpression": {
      const a = analyzeExpr(node.consequent, context, opts, seen);
      const b = analyzeExpr(node.alternate, context, opts, seen);
      // ВАЖНО: тут теперь собираем ОБЕ ветки, а не возвращаем первую
      return mergeResults([a, b]);
    }

    case "Identifier": {
      if (seen.has(node.name)) return { status: "unknown", nodes: [] };
      seen.add(node.name);

      const defNode = resolveIdentifierDefNode(context, node);
      if (!defNode) return { status: "unknown", nodes: [] };

      return analyzeExpr(defNode, context, opts, seen);
    }

    case "ArrowFunctionExpression":
    case "FunctionExpression":
    case "FunctionDeclaration": {
      // анализируем return'ы функции (если можем)
      const returns = collectReturnArgs(node);
      if (!returns.length) return { status: "unknown", nodes: [] };

      const parts = returns.map((arg) => analyzeExpr(arg, context, opts, seen));
      return mergeResults(parts);
    }

    case "CallExpression": {
      // кроме __t(...) попробуем раскрыть вызов локальной функции: text()
      if (node.callee?.type === "Identifier") {
        const name = node.callee.name;
        if (seen.has(`call:${name}`)) return { status: "unknown", nodes: [] };
        seen.add(`call:${name}`);

        const defNode = resolveIdentifierDefNode(context, node.callee);
        if (
          defNode &&
          (defNode.type === "ArrowFunctionExpression" ||
            defNode.type === "FunctionExpression" ||
            defNode.type === "FunctionDeclaration")
        ) {
          return analyzeExpr(defNode, context, opts, seen);
        }
      }
      return { status: "unknown", nodes: [] };
    }

    default:
      return { status: "unknown", nodes: [] };
  }
}

export default {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow hardcoded strings in DOM sinks; require __t(...)",
    },
    schema: [
      {
        type: "object",
        properties: {
          tFunction: { type: "string" },
          allowStaticChunks: { type: "boolean" },
        },
        additionalProperties: true,
      },
    ],
  },

  create(context) {
    const userOpts = context.options?.[0] || {};
    const opts = { ...DEFAULTS, ...userOpts };

    function report(node) {
      const hard = extractHardcodedText(node, context);
      const shown = hard ? ` "${hard}"` : "";

      context.report({
        node,
        message: `Есть сырой текст${shown}. Нужно перенести в json`,
      });
    }

    return {
      AssignmentExpression(node) {
        if (node.left?.type !== "MemberExpression") return;

        const prop = getMemberPropName(node.left);
        if (!prop || !opts.sinks.has(prop)) return;

        // innerHTML: разрешаем статический HTML-скелет без видимого текста
        if (prop === "innerHTML") {
          const staticStr = tryGetStaticString(node.right);
          if (staticStr != null && isAllowedStaticInnerHTML(staticStr)) return;
        }

        const res = analyzeExpr(node.right, context, opts);

        if (res.status === "hardcoded") {
          // теперь репортим ВСЕ найденные хардкоды (для тернарника будет 2)
          for (const n of res.nodes) {
            report(n, `.${prop}`, "HARDCODED_JS_TEXT");
          }
        }
      },

      CallExpression(node) {
        const callee = node.callee;
        if (callee?.type !== "MemberExpression") return;

        const method = getMemberPropName(callee);
        if (method !== "setAttribute") return;

        const [nameArg, valueArg] = node.arguments || [];
        if (!nameArg || !valueArg) return;

        if (
          nameArg.type === "Literal" &&
          typeof nameArg.value === "string" &&
          nameArg.value.toLowerCase() === "placeholder"
        ) {
          const res = analyzeExpr(valueArg, context, opts);
          if (res.status === "hardcoded") {
            for (const n of res.nodes) {
              report(n, 'setAttribute("placeholder")', "HARDCODED_PLACEHOLDER");
            }
          }
        }
      },
    };
  },
};

function tryGetStaticString(node) {
  if (!node) return null;

  if (node.type === "Literal" && typeof node.value === "string") return node.value;

  if (node.type === "TemplateLiteral") {
    // только полностью статичный шаблон (без ${...})
    if (node.expressions?.length) return null;
    return (node.quasis || []).map((q) => q?.value?.cooked ?? q?.value?.raw ?? "").join("");
  }

  if (node.type === "BinaryExpression" && node.operator === "+") {
    const l = tryGetStaticString(node.left);
    if (l == null) return null;
    const r = tryGetStaticString(node.right);
    if (r == null) return null;
    return l + r;
  }

  return null;
}

function getVisibleTextFromHtml(html) {
  if (html == null) return "";
  const s = String(html);

  // если хочешь — можно запретить такие штуки вообще
  if (/<\s*script\b/i.test(s) || /<\s*style\b/i.test(s)) return null;

  return s.replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]*>/g, "");
}

function isAllowedStaticInnerHTML(html) {
  const visible = getVisibleTextFromHtml(html);
  if (visible == null) return false;

  // пусто/пробелы/символы типа "×" — ок
  return isAllowedStaticChunk(visible);
}
