// Pattern rules: does a piece of free text look like source code or a secret?
// The profile stores words about decisions, never the code itself.

export interface RuleHit {
  rule: string;
  kind: "code" | "secret";
}

/** Removes tricks that hide text from the rules: invisible characters and look-alike Unicode forms. */
export function cleanText(text: string): string {
  return text.normalize("NFKC").replace(/[​-‍⁠﻿­]/g, "");
}

const SECRET_RULES: [string, RegExp][] = [
  ["private-key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["aws-access-key", /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ["github-token", /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_\w{20,})/],
  ["api-key", /\b(?:sk|pk|rk)[-_](?:(?:live|test|proj|ant)[-_])?[A-Za-z0-9_-]{20,}/],
  ["slack-token", /\bxox[baprs]-[A-Za-z0-9-]{10,}/],
  ["jwt", /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/],
  // password = hunter2x, api_key: "abc123..." (the value must hold a digit, so plain prose passes)
  ["credential-assignment", /\b(?:password|passwd|pwd|secret|api[_-]?key|token|access[_-]?key)\b\s*[:=]\s*['"]?(?=[^\s'"]*\d)[^\s'"]{8,}/i],
  ["connection-string", /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:[^\s:@/]+@/i],
];

const CODE_RULES: [string, RegExp][] = [
  ["code-fence", /```|~~~/],
  ["variable-declaration", /\b(?:const|let|var|val|final)\s+[\w$]+\s*(?::\s*[^=\n]{1,40})?=(?!=)/],
  ["function-definition", /\bfunction\s*[\w$]*\s*\([^)]*\)\s*\{|\bdef\s+\w+\s*\([^)]*\)\s*(?:->[^:\n]+)?:|\b(?:func|fn)\s+\w+\s*\([^)]*\)/],
  ["arrow-function", /(?:\([^()\n]*\)|[\w$]+)\s*=>\s*\S/],
  ["import-statement", /\bimport\s+(?:[\w${},*\s]+\s+from\s+)?['"][^'"\n]+['"]|\brequire\s*\(\s*['"]|\bfrom\s+[\w.]+\s+import\s+\w|#include\s*[<"]/],
  ["class-definition", /\b(?:class|interface|struct|enum)\s+\w+[^.\n]{0,60}\{/],
  ["control-flow-block", /\b(?:if|for|while|switch|catch)\s*\([^)\n]*\)\s*\{|\b(?:if|elif|for|while)\b[^.\n]{1,80}:\s*\n\s+\S/],
  ["return-statement", /\breturn\s+[^\n;]{1,80};/],
  ["call-statement", /\b[\w$.]+\([^()\n]*\)\s*;/],
  ["assignment-statement", /\b[\w$.[\]]+\s*[+\-*/|&]?=\s*[^=\n;]{1,80};/],
  ["call-chain", /\b[\w$]+(?:\.[\w$]+\([^()\n]*\)){2,}/],
  ["object-literal", /\{\s*["']?[\w$]+["']?\s*:\s*[^{}\n]{1,60}(?:,\s*["']?[\w$]+["']?\s*:\s*[^{}\n]{1,60})+,?\s*\}/],
  ["markup", /<\/[A-Za-z][\w.-]*\s*>|<[A-Za-z][\w.-]*(?:\s+[\w:-]+\s*=\s*(?:"[^"]*"|'[^']*'|\{[^}]*\}))+\s*\/?>/],
  [
    "sql",
    /\bselect\s+(?:\*|[\w.]+(?:\s*,\s*[\w.]+)*)\s+from\s+[\w.]+(?:\s+(?:where|join|order\s+by|group\s+by|limit)\b|\s*;)|\bselect\s+\*\s+from\s+\w|\b(?:INSERT\s+INTO|DELETE\s+FROM|CREATE\s+TABLE|DROP\s+TABLE|ALTER\s+TABLE)\s+\w|\bUPDATE\s+\w+\s+SET\s/i,
  ],
  ["encoded-blob", /[A-Za-z0-9+/_-]{80,}={0,2}|\b[0-9a-fA-F]{64,}\b/],
];

const CODE_SYMBOLS = /[{}[\]();=<>|&]/g;

/** Prose rarely has this many brackets and operators. Catches code the named rules miss. */
function symbolDense(text: string): boolean {
  if (text.length < 40) return false;
  const count = text.match(CODE_SYMBOLS)?.length ?? 0;
  return count >= 8 && count / text.length > 0.1;
}

/** Several indented lines that end like statements: pasted code with the keywords changed. */
function looksLikeCodeBlock(text: string): boolean {
  const lines = text.split(/\r?\n/);
  if (lines.length < 3) return false;
  return lines.filter((line) => /[{};,)]\s*$/.test(line) && /[(){}=]/.test(line)).length >= 2;
}

export function findRuleHit(rawText: string): RuleHit | null {
  const text = cleanText(rawText);
  for (const [rule, pattern] of SECRET_RULES) if (pattern.test(text)) return { rule, kind: "secret" };
  for (const [rule, pattern] of CODE_RULES) if (pattern.test(text)) return { rule, kind: "code" };
  if (symbolDense(text)) return { rule: "symbol-density", kind: "code" };
  if (looksLikeCodeBlock(text)) return { rule: "code-block-shape", kind: "code" };
  return null;
}
