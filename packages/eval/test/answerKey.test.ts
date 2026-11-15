import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ANSWER_KEY_DIR, loadAnswerKey } from "../src/answerKey";

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, "../../..");
const DEMO_REPO = resolve(REPO_ROOT, "demo-repo");
const PLUGIN = resolve(REPO_ROOT, "packages/plugin");

async function textFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const name of await readdir(dir)) {
    if (name === "node_modules" || name === ".git" || name === "dist") continue;
    const path = join(dir, name);
    if ((await stat(path)).isDirectory()) out.push(...(await textFiles(path)));
    else if (/\.(md|ts|json|txt|ya?ml)$/.test(name) && name !== "package-lock.json") out.push(path);
  }
  return out;
}

describe("DEMO-1 answer key", () => {
  it("has five planted ambiguities, each with at least two readings", async () => {
    const key = await loadAnswerKey("DEMO-1");
    expect(key.planted).toHaveLength(5);
    expect(new Set(key.planted.map((p) => p.id)).size).toBe(5);
    for (const planted of key.planted) {
      expect(planted.readings.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("quotes phrases that are really in the ticket", async () => {
    const key = await loadAnswerKey("DEMO-1");
    const ticket = await readFile(join(DEMO_REPO, "tickets/DEMO-1.md"), "utf8");
    for (const planted of key.planted) {
      expect(ticket, planted.id).toContain(planted.ticket_phrase);
    }
  });

  it("grounds every ambiguity in files that exist in the demo repo", async () => {
    const key = await loadAnswerKey("DEMO-1");
    for (const planted of key.planted) {
      for (const file of planted.grounding) {
        await expect(stat(join(DEMO_REPO, file)), `${planted.id}: ${file}`).resolves.toBeTruthy();
      }
    }
  });

  it("lives outside the demo repo and outside the plugin", () => {
    expect(relative(DEMO_REPO, ANSWER_KEY_DIR).startsWith("..")).toBe(true);
    expect(relative(PLUGIN, ANSWER_KEY_DIR).startsWith("..")).toBe(true);
  });

  it("does not leak into the demo repo or the plugin", async () => {
    const key = await loadAnswerKey("DEMO-1");
    const secrets = [
      ...key.planted.flatMap((p) => [p.po_answer, p.ambiguity, ...p.readings]),
      ...key.decoys.map((d) => d.question),
    ];
    for (const file of [...(await textFiles(DEMO_REPO)), ...(await textFiles(PLUGIN))]) {
      const content = await readFile(file, "utf8");
      expect(content.toLowerCase(), file).not.toContain("answer key");
      expect(content.toLowerCase(), file).not.toContain("answer-key");
      for (const secret of secrets) {
        expect(content, `${file} contains: ${secret}`).not.toContain(secret);
      }
    }
  });
});
