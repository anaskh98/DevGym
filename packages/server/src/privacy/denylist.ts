// Client-name denylist: names that must never be stored, however they are spelled.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { defaultDbPath } from "../db/connection.js";

/** The list lives next to the local database, outside any repo, because it holds client names itself. */
export function defaultDenylistPath(): string {
  return process.env.FTC_DENYLIST_PATH ?? join(dirname(defaultDbPath()), "denylist.txt");
}

/** One name per line. Blank lines and lines starting with # are ignored. FTC_DENYLIST adds comma-separated names. */
export function loadDenylist(path: string = defaultDenylistPath()): string[] {
  const names: string[] = [];
  try {
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const name = line.trim();
      if (name && !name.startsWith("#")) names.push(name);
    }
  } catch {
    // No file: an empty list.
  }
  for (const name of (process.env.FTC_DENYLIST ?? "").split(",")) {
    if (name.trim()) names.push(name.trim());
  }
  return names;
}

// Letters from other alphabets that look like Latin ones (Cyrillic and Greek).
const LOOKALIKES: Record<string, string> = {
  а: "a", в: "b", е: "e", к: "k", м: "m", н: "h", о: "o", р: "p", с: "c", т: "t", у: "y", х: "x", і: "i", ј: "j", ѕ: "s",
  α: "a", β: "b", ε: "e", ι: "i", κ: "k", ν: "v", ο: "o", ρ: "p", τ: "t", υ: "u", χ: "x",
};
const LEET_I: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", $: "s", "!": "i" };
const LEET_L: Record<string, string> = { ...LEET_I, "1": "l" };

/** Lowercase letters and digits only: "Ácme-Corp" and "a c m e  c o r p" both become "acmecorp". */
function squash(text: string, leet?: Record<string, string>): string {
  let out = "";
  for (const ch of text.normalize("NFKD").toLowerCase()) {
    const mapped = LOOKALIKES[ch] ?? leet?.[ch] ?? ch;
    if (/[a-z0-9]/.test(mapped)) out += mapped;
  }
  return out;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** True when the text holds any denylisted name, also when spaced out, accented, or written with digits. */
export function containsBlockedName(text: string, names: string[]): boolean {
  if (names.length === 0) return false;
  const variants = [squash(text), squash(text, LEET_I), squash(text, LEET_L)];
  const lower = text.normalize("NFKC").toLowerCase();
  for (const name of names) {
    const key = squash(name);
    if (key.length >= 4) {
      if (variants.some((v) => v.includes(key))) return true;
    } else if (key.length > 0) {
      // A very short name would match inside ordinary words, so it must stand alone.
      if (new RegExp(`(?<![a-z0-9])${escapeRegExp(name.toLowerCase())}(?![a-z0-9])`).test(lower)) return true;
    }
  }
  return false;
}
