import { STORED_TABLES, type ExportResponse } from "@devgym/shared";

/** What each table holds, in the words the "My data" page uses. */
export const TABLE_INFO: Record<string, { label: string; what: string }> = {
  tickets: { label: "Tickets", what: "The tickets Clarify has read." },
  assumptions: {
    label: "Questions and assumptions",
    what: "What Clarify asked about each ticket, and whether the PO answered or the developer assumed.",
  },
  trail_sessions: { label: "Coding sessions", what: "The coding sessions Track followed, and their ticket." },
  file_edits: { label: "Edited files", what: "Which files each session edited. Paths only, never the content." },
  decisions: { label: "Decisions", what: "Choices made while coding a ticket, and who made each one." },
  pointers: { label: "Code pointers", what: "Where each decision lives: file, function and line. Never the code itself." },
  explain_backs: { label: "Explanations", what: "Your own explanations of decisions, each with a rating." },
  observations: { label: "Observations", what: "Notes about your skills, each tied to the decisions it rests on." },
  growth_plans: { label: "Growth plans", what: "Grow's focus areas and exercises." },
  annotations: { label: "Your notes", what: "Notes you added, including where you disagreed." },
};

/** Every table in the export, known ones first in page order, then any the service added later. */
export function tablesOf(response: ExportResponse): string[] {
  const extra = Object.keys(response.data).filter((t) => !(STORED_TABLES as readonly string[]).includes(t));
  return [...STORED_TABLES, ...extra.sort()];
}

export function totalRecords(response: ExportResponse): number {
  return Object.values(response.data).reduce((sum, rows) => sum + rows.length, 0);
}

export interface ExportFile {
  filename: string;
  text: string;
}

/** The export is the service's own export, unchanged, so the file matches what is stored. */
export function buildExport(response: ExportResponse, today: Date = new Date()): ExportFile {
  return {
    filename: `devgym-export-${today.toISOString().slice(0, 10)}.json`,
    text: `${JSON.stringify(response, null, 2)}\n`,
  };
}

export function downloadFile(file: ExportFile): void {
  const url = URL.createObjectURL(new Blob([file.text], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = file.filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** A stored row, as the export gives it. */
export type Row = Record<string, unknown>;

/** The page groups the tables by the part of the tool that writes them. */
export const TABLE_GROUPS: { title: string; tables: string[] }[] = [
  { title: "Clarify", tables: ["tickets", "assumptions"] },
  { title: "Track", tables: ["trail_sessions", "file_edits", "decisions", "pointers"] },
  { title: "Explain and Grow", tables: ["explain_backs", "observations", "growth_plans", "annotations"] },
];

/** The text in a field, or "" when it is missing or not text. */
export function text(row: Row, key: string): string {
  const value = row[key];
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return "";
}

/** The number in a field, or null. */
export function num(row: Row, key: string): number | null {
  const value = row[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** SQLite keeps booleans as 0 and 1. */
export function flag(row: Row, key: string): boolean {
  const value = row[key];
  return value === true || value === 1 || value === "1";
}

/** A list field: an array, or a JSON array kept as text. */
export function list(row: Row, key: string): unknown[] {
  const value = row[key];
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

/** Rows of a table, indexed by one of their fields. */
export function indexBy(rows: Row[] | undefined, key: string): Map<string, Row> {
  const map = new Map<string, Row>();
  for (const row of rows ?? []) {
    const id = text(row, key);
    if (id) map.set(id, row);
  }
  return map;
}

/** How many rows of a table share each value of a field. */
export function countBy(rows: Row[] | undefined, key: string): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows ?? []) {
    const id = text(row, key);
    if (id) map.set(id, (map.get(id) ?? 0) + 1);
  }
  return map;
}

/** Markdown as plain text, for a short preview on a card. */
export function plainPreview(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, "")
    .replace(/(\*\*|__|\*|_|`)(\S(?:.*?\S)?)\1/g, "$2")
    .replace(/\n{2,}/g, "\n")
    .trim();
}
