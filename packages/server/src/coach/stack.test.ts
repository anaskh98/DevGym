import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectStacks, stackForPath } from "./stack.js";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ftc-stack-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function put(path: string, text: string) {
  mkdirSync(join(root, path, ".."), { recursive: true });
  writeFileSync(join(root, path), text);
}
const pkg = (deps: Record<string, string>) => JSON.stringify({ name: "x", dependencies: deps });

describe("detectStacks", () => {
  it("finds one stack per folder in a monorepo, and Next.js wins over React", () => {
    put("api/package.json", pkg({ express: "^4" }));
    put("web/package.json", pkg({ react: "^19", next: "^15" }));
    const hits = detectStacks(root);
    expect(hits).toContainEqual({ stack_id: "express", track: "backend", folder: "api" });
    expect(hits).toContainEqual({ stack_id: "nextjs", track: "frontend", folder: "web" });
    expect(hits.some((h) => h.stack_id === "react")).toBe(false);
  });

  it("reads other ecosystems", () => {
    put("pom.xml", "<project><dependency><groupId>org.springframework.boot</groupId></dependency></project>");
    put("svc/go.mod", "module x\n");
    put("py/requirements.txt", "fastapi==0.110\n");
    put("dotnet/App.csproj", "<Project />");
    const ids = detectStacks(root).map((h) => `${h.folder}:${h.stack_id}`).sort();
    expect(ids).toEqual(["", "dotnet:dotnet", "py:fastapi", "svc:go"].map((x) => (x === "" ? ":spring" : x)).sort());
  });

  it("skips node_modules and broken package files", () => {
    put("node_modules/x/package.json", pkg({ express: "^4" }));
    put("bad/package.json", "{ nope");
    expect(detectStacks(root)).toEqual([]);
  });

  it("returns nothing for an empty folder", () => {
    expect(detectStacks(root)).toEqual([]);
  });
});

describe("stackForPath", () => {
  it("picks the deepest folder of the right track", () => {
    put("api/package.json", pkg({ express: "^4" }));
    put("web/package.json", pkg({ react: "^19", next: "^15" }));
    put("package.json", pkg({ react: "^19" }));
    const hits = detectStacks(root);
    expect(stackForPath(hits, "web/app/page.tsx", "frontend")).toBe("nextjs");
    expect(stackForPath(hits, "api/src/pay.ts", "backend")).toBe("express");
    expect(stackForPath(hits, "tools/x.ts", "frontend")).toBe("react");
    expect(stackForPath(hits, "tools/x.ts", "backend")).toBeNull();
  });
});
