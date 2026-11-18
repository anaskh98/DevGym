import { describe, expect, it } from "vitest";
import { extensionOf, isCodeLine, matchLine, ruleMatches, type LineRule } from "./engine.js";

const rule: LineRule = { id: "t.timeout", pattern: /timeout\s*:\s*\d/, unless: /timeout\s*:\s*0\b/, extensions: [".ts", ".js"] };

describe("ruleMatches", () => {
  it("matches code lines in the listed extensions", () => {
    expect(ruleMatches(rule, "src/pay.ts", "  const opts = { timeout: 5000 };")).toBe(true);
    expect(ruleMatches(rule, "src/pay.py", "timeout: 5000")).toBe(false);
  });

  it("honours unless", () => {
    expect(ruleMatches(rule, "a.ts", "fetch(u, { timeout: 0 })")).toBe(false);
  });

  it("refuses a rule with a stateful g flag", () => {
    const bad: LineRule = { id: "t.g", pattern: /x/g, extensions: [] };
    expect(() => ruleMatches(bad, "a.ts", "x")).toThrow(/g or y flag/);
  });

  it("matches any code file when the extension list is empty", () => {
    const any: LineRule = { id: "t.any", pattern: /fetch\(/, extensions: [] };
    expect(ruleMatches(any, "x.go", "fetch(u)")).toBe(true);
  });
});

describe("isCodeLine", () => {
  it("skips blank, comment and import lines", () => {
    for (const line of [
      "",
      "   ",
      "// timeout: 5000",
      " * timeout: 5",
      "# timeout: 5",
      "/* timeout: 5 */",
      "-- timeout: 5",
      "<!-- timeout: 5 -->",
      "import { timeout } from './t';",
      'import "./setup";',
      "const t = require('t');",
      "using System.Net;",
      "package com.acme.pay;",
      "from x import y",
    ]) {
      expect(isCodeLine(line), line).toBe(false);
    }
  });

  it("keeps real code lines", () => {
    expect(isCodeLine("const t = { timeout: 5 };")).toBe(true);
    expect(isCodeLine("  return a * b;")).toBe(true);
  });
});

describe("matchLine", () => {
  it("lists every matching rule", () => {
    const other: LineRule = { id: "t.any", pattern: /fetch\(/, extensions: [] };
    expect(matchLine([rule, other], "a.ts", "fetch(u, { timeout: 5 })").map((r) => r.id)).toEqual(["t.timeout", "t.any"]);
  });
});

describe("extensionOf", () => {
  it("gives the lowercase extension with its dot", () => {
    expect(extensionOf("src/App.TSX")).toBe(".tsx");
    expect(extensionOf("Makefile")).toBe("");
    expect(extensionOf(".github/x.yml")).toBe(".yml");
  });
});
