// A small engine for regex rules that read one line of code at a time.
// Shared by every feature that scans diffs, so each one does not grow its own copy.

export interface LineRule {
  id: string;
  /** Must match the line. Never use the g or y flag: those keep state between calls and give wrong answers. */
  pattern: RegExp;
  /** If this also matches, the rule does not hit. */
  unless?: RegExp;
  /** Lowercase extensions with the dot, for example ".ts". An empty list means every file. */
  extensions: readonly string[];
}

const COMMENT = /^\s*(\/\/|#|--|\/\*|\*|<!--)/;
const IMPORT_LINES = [
  /^\s*import\s.+\sfrom\s+['"][^'"]+['"]\s*;?\s*$/,
  /^\s*import\s+['"][^'"]+['"]\s*;?\s*$/,
  /^\s*(const|let|var)\s+[\w{}\s,:]+\s*=\s*require\(\s*['"][^'"]+['"]\s*\)\s*;?\s*$/,
  /^\s*using\s+[\w.]+\s*;\s*$/,
  /^\s*package\s+[\w.]+\s*;?\s*$/,
  /^\s*from\s+[\w.]+\s+import\s.+$/,
  /^\s*import\s+[\w.]+(\s+as\s+\w+)?\s*;?\s*$/,
];

/** False for blank lines, comment lines and whole-line imports: rules never hit those. */
export function isCodeLine(line: string): boolean {
  if (line.trim() === "") return false;
  if (COMMENT.test(line)) return false;
  return !IMPORT_LINES.some((re) => re.test(line));
}

export function extensionOf(filePath: string): string {
  const name = filePath.replace(/\\/g, "/").split("/").pop() ?? "";
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot).toLowerCase() : "";
}

function checkFlags(rule: LineRule): void {
  for (const re of [rule.pattern, rule.unless]) {
    if (re && (re.global || re.sticky)) throw new Error(`Rule ${rule.id} uses a g or y flag; remove it`);
  }
}

export function ruleMatches(rule: LineRule, filePath: string, line: string): boolean {
  checkFlags(rule);
  if (rule.extensions.length > 0 && !rule.extensions.includes(extensionOf(filePath))) return false;
  if (!isCodeLine(line)) return false;
  if (!rule.pattern.test(line)) return false;
  return !(rule.unless && rule.unless.test(line));
}

export function matchLine(rules: readonly LineRule[], filePath: string, line: string): LineRule[] {
  return rules.filter((rule) => ruleMatches(rule, filePath, line));
}
