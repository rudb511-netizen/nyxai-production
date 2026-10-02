export type CodeToken = { t: string; k: "kw" | "str" | "cm" | "num" | "fn" | "plain" };

const KEYS: Record<string, string[]> = {
  ts: ["const", "let", "var", "function", "return", "if", "else", "for", "while", "class", "import", "from", "export", "async", "await", "type", "interface", "new", "try", "catch", "throw", "switch", "case", "break", "continue", "true", "false", "null", "undefined", "this"],
  js: ["const", "let", "var", "function", "return", "if", "else", "for", "while", "class", "import", "from", "export", "async", "await", "new", "try", "catch", "throw", "switch", "case", "true", "false", "null", "this"],
  py: ["def", "return", "if", "elif", "else", "for", "while", "class", "import", "from", "as", "async", "await", "try", "except", "raise", "with", "yield", "True", "False", "None", "lambda", "pass"],
  sql: ["select", "from", "where", "insert", "into", "values", "update", "set", "delete", "join", "left", "right", "inner", "on", "group", "by", "order", "limit", "and", "or", "not", "as", "create", "table"],
  css: ["@media", "@import", "important", "from", "to"],
};

function langKeys(lang: string): string[] {
  const l = lang.toLowerCase();
  if (l === "typescript" || l === "tsx" || l === "ts") return KEYS.ts!;
  if (l === "javascript" || l === "jsx" || l === "js") return KEYS.js!;
  if (l === "python" || l === "py") return KEYS.py!;
  if (l === "sql") return KEYS.sql!;
  if (l === "css") return KEYS.css!;
  return KEYS.ts!;
}

export function highlightCode(lang: string, src: string): CodeToken[] {
  const keys = new Set(langKeys(lang));
  const tokens: CodeToken[] = [];
  const re =
    /(\/\/[^\n]*|\/\*[\s\S]*?\*\/|#[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b\d+(?:\.\d+)?\b|\b[A-Za-z_][\w]*\b)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (m.index > last) tokens.push({ t: src.slice(last, m.index), k: "plain" });
    const piece = m[0]!;
    let k: CodeToken["k"] = "plain";
    if (/^\/\//.test(piece) || /^\/\*/.test(piece) || /^#/.test(piece)) k = "cm";
    else if (/^['"`]/.test(piece)) k = "str";
    else if (/^\d/.test(piece)) k = "num";
    else if (keys.has(piece)) k = "kw";
    else if (src[m.index + piece.length] === "(") k = "fn";
    tokens.push({ t: piece, k });
    last = m.index + piece.length;
  }
  if (last < src.length) tokens.push({ t: src.slice(last), k: "plain" });
  return tokens;
}
