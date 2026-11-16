// Finds the function, method or class around a line, using tree-sitter.
// A pointer stores that name, so it still finds the code after the lines above it move.
import { existsSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Language, Parser, type Node } from "web-tree-sitter";

export interface SymbolInfo {
  /** Qualified name, for example "Exporter.run" for a method. */
  name: string;
  startLine: number;
  endLine: number;
}

const GRAMMARS: Record<string, { file: string; pkg: string }> = {
  ".ts": { file: "tree-sitter-typescript.wasm", pkg: "tree-sitter-typescript" },
  ".mts": { file: "tree-sitter-typescript.wasm", pkg: "tree-sitter-typescript" },
  ".cts": { file: "tree-sitter-typescript.wasm", pkg: "tree-sitter-typescript" },
  ".tsx": { file: "tree-sitter-tsx.wasm", pkg: "tree-sitter-typescript" },
  ".js": { file: "tree-sitter-javascript.wasm", pkg: "tree-sitter-javascript" },
  ".mjs": { file: "tree-sitter-javascript.wasm", pkg: "tree-sitter-javascript" },
  ".cjs": { file: "tree-sitter-javascript.wasm", pkg: "tree-sitter-javascript" },
  ".jsx": { file: "tree-sitter-javascript.wasm", pkg: "tree-sitter-javascript" },
};

/**
 * The .wasm files sit in "wasm/" next to the bundled server inside the plugin.
 * When running from source or tests they are read straight from node_modules.
 */
function wasmPath(file: string, pkg: string): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const bundled = join(here, "wasm", file);
  return existsSync(bundled) ? bundled : join(here, "..", "..", "node_modules", pkg, file);
}

let ready: Promise<void> | undefined;
const parsers = new Map<string, Promise<Parser>>();

function parserFor(filePath: string): Promise<Parser> | null {
  const grammar = GRAMMARS[extname(filePath).toLowerCase()];
  if (!grammar) return null;
  let parser = parsers.get(grammar.file);
  if (!parser) {
    parser = (async () => {
      ready ??= Parser.init({ locateFile: () => wasmPath("web-tree-sitter.wasm", "web-tree-sitter") });
      await ready;
      const p = new Parser();
      p.setLanguage(await Language.load(wasmPath(grammar.file, grammar.pkg)));
      return p;
    })();
    parsers.set(grammar.file, parser);
  }
  return parser;
}

export function isSupported(filePath: string): boolean {
  return extname(filePath).toLowerCase() in GRAMMARS;
}

// Node types that always name something worth pointing at.
const NAMED = new Set([
  "function_declaration",
  "generator_function_declaration",
  "class_declaration",
  "abstract_class_declaration",
  "method_definition",
  "interface_declaration",
  "type_alias_declaration",
  "enum_declaration",
]);
const FUNCTION_VALUES = new Set(["arrow_function", "function_expression", "function", "class", "generator_function"]);

/** The name a node declares, or null when it is not a declaration we point at. */
function declaredName(node: Node): string | null {
  if (NAMED.has(node.type)) return node.childForFieldName("name")?.text ?? null;
  // const run = () => {...}; also any const at the top level of the file.
  if (node.type === "variable_declarator") {
    const name = node.childForFieldName("name");
    if (name?.type !== "identifier") return null;
    const value = node.childForFieldName("value");
    const topLevel = node.parent?.parent?.type === "program" || node.parent?.parent?.type === "export_statement";
    return (value && FUNCTION_VALUES.has(value.type)) || topLevel ? name.text : null;
  }
  // class X { handler = () => {...} }
  if (node.type === "public_field_definition" || node.type === "field_definition") {
    const value = node.childForFieldName("value");
    const name = node.childForFieldName("name") ?? node.childForFieldName("property");
    return value && FUNCTION_VALUES.has(value.type) && name ? name.text : null;
  }
  return null;
}

/** Every declaration in a file. Returns null when the language is not supported. */
export async function listSymbols(filePath: string, source: string): Promise<SymbolInfo[] | null> {
  const pending = parserFor(filePath);
  if (!pending) return null;
  const tree = (await pending).parse(source);
  if (!tree) return null;
  const symbols: SymbolInfo[] = [];
  const visit = (node: Node, scope: string[]): void => {
    const name = declaredName(node);
    const inner = name ? [...scope, name] : scope;
    if (name) symbols.push({ name: inner.join("."), startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 });
    for (const child of node.namedChildren) if (child) visit(child, inner);
  };
  try {
    visit(tree.rootNode, []);
  } finally {
    tree.delete();
  }
  return symbols;
}

/** The innermost declaration that contains the line (1-based), or null. */
export async function symbolAtLine(filePath: string, source: string, line: number): Promise<SymbolInfo | null> {
  const symbols = await listSymbols(filePath, source);
  if (!symbols) return null;
  let best: SymbolInfo | null = null;
  for (const s of symbols) {
    if (line < s.startLine || line > s.endLine) continue;
    if (!best || s.endLine - s.startLine <= best.endLine - best.startLine) best = s;
  }
  return best;
}

/**
 * Finds a declaration by name. An exact qualified name wins ("Exporter.run");
 * a bare name ("run") matches only when exactly one declaration ends with it.
 */
export async function findSymbol(filePath: string, source: string, name: string): Promise<SymbolInfo | null> {
  const symbols = await listSymbols(filePath, source);
  if (!symbols) return null;
  const exact = symbols.find((s) => s.name === name);
  if (exact) return exact;
  const loose = symbols.filter((s) => s.name.split(".").at(-1) === name.split(".").at(-1));
  return loose.length === 1 ? (loose[0] ?? null) : null;
}
