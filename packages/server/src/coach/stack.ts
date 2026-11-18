// Finds the stack of each part of the project (for example an Express API and a Next.js web app), so the plan
// can give best practice for the stack the developer really works in.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Track } from "./ladder/schema.js";

export interface StackHit {
  stack_id: string;
  track: Track;
  /** Repo-relative folder with forward slashes, "" for the root. */
  folder: string;
}

const SKIP = new Set(["node_modules", ".git", "dist", "build", "vendor", ".next", "out", "target", "bin", "obj", ".venv", "venv"]);

/** npm packages that name a stack. Earlier entries win within a track, so next beats react. */
const NPM: { dep: string; stack_id: string; track: Track }[] = [
  { dep: "@nestjs/core", stack_id: "nestjs", track: "backend" },
  { dep: "express", stack_id: "express", track: "backend" },
  { dep: "fastify", stack_id: "fastify", track: "backend" },
  { dep: "koa", stack_id: "koa", track: "backend" },
  { dep: "next", stack_id: "nextjs", track: "frontend" },
  { dep: "@angular/core", stack_id: "angular", track: "frontend" },
  { dep: "react", stack_id: "react", track: "frontend" },
  { dep: "vue", stack_id: "vue", track: "frontend" },
  { dep: "svelte", stack_id: "svelte", track: "frontend" },
];
const PYTHON: { word: RegExp; stack_id: string }[] = [
  { word: /\bdjango\b/i, stack_id: "django" },
  { word: /\bfastapi\b/i, stack_id: "fastapi" },
  { word: /\bflask\b/i, stack_id: "flask" },
];

function read(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function stacksInFolder(abs: string, folder: string): StackHit[] {
  const hits: StackHit[] = [];
  const add = (stack_id: string, track: Track) => {
    if (!hits.some((h) => h.track === track)) hits.push({ stack_id, track, folder });
  };

  const pkgText = read(join(abs, "package.json"));
  if (pkgText !== null) {
    try {
      const pkg = JSON.parse(pkgText) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
      const deps = { ...pkg.devDependencies, ...pkg.dependencies };
      for (const n of NPM) if (n.dep in deps) add(n.stack_id, n.track);
    } catch {
      // A broken package.json is skipped, never fatal.
    }
  }
  for (const file of ["pom.xml", "build.gradle", "build.gradle.kts"]) {
    const text = read(join(abs, file));
    if (text !== null && /spring/i.test(text)) add("spring", "backend");
  }
  if (existsSync(join(abs, "go.mod"))) add("go", "backend");
  for (const file of ["requirements.txt", "pyproject.toml"]) {
    const text = read(join(abs, file));
    if (text === null) continue;
    const found = PYTHON.find((p) => p.word.test(text));
    if (found) add(found.stack_id, "backend");
  }
  try {
    if (readdirSync(abs).some((name) => name.endsWith(".csproj"))) add("dotnet", "backend");
  } catch {
    // An unreadable folder has no stack.
  }
  return hits;
}

/** Looks at the root and folders up to 2 levels deep. */
export function detectStacks(root: string): StackHit[] {
  const hits: StackHit[] = [];
  const walk = (abs: string, folder: string, depth: number) => {
    hits.push(...stacksInFolder(abs, folder));
    if (depth >= 2) return;
    let names: string[];
    try {
      names = readdirSync(abs);
    } catch {
      return;
    }
    for (const name of names) {
      if (SKIP.has(name) || name.startsWith(".")) continue;
      const child = join(abs, name);
      try {
        if (!statSync(child).isDirectory()) continue;
      } catch {
        continue;
      }
      walk(child, folder === "" ? name : `${folder}/${name}`, depth + 1);
    }
  };
  walk(root, "", 0);
  return hits;
}

/** The stack of the deepest folder of that track that holds the file, or null. */
export function stackForPath(stacks: StackHit[], filePath: string, track: Track): string | null {
  const path = filePath.replaceAll("\\", "/");
  let best: StackHit | null = null;
  for (const hit of stacks) {
    if (hit.track !== track) continue;
    const inside = hit.folder === "" || path === hit.folder || path.startsWith(`${hit.folder}/`);
    if (inside && (best === null || hit.folder.length > best.folder.length)) best = hit;
  }
  return best?.stack_id ?? null;
}
