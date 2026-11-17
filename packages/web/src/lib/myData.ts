import { STORED_TABLES, type ExportResponse } from "@ftc/shared";

/** What each table holds, in the words the "My data" page uses. */
export const TABLE_INFO: Record<string, { label: string; what: string }> = {
  tickets: { label: "Tickets", what: "The tickets Fork has read." },
  assumptions: {
    label: "Questions and assumptions",
    what: "What Fork asked about each ticket, and whether the PO answered or the developer assumed.",
  },
  trail_sessions: { label: "Coding sessions", what: "The coding sessions Paper Trail followed, and their ticket." },
  file_edits: { label: "Edited files", what: "Which files each session edited. Paths only, never the content." },
  decisions: { label: "Decisions", what: "Choices made while coding a ticket, and who made each one." },
  pointers: { label: "Code pointers", what: "Where each decision lives: file, function and line. Never the code itself." },
  explain_backs: { label: "Explain-backs", what: "Your own explanations of decisions, each with a rating." },
  observations: { label: "Observations", what: "Notes about your skills, each tied to the decisions it rests on." },
  growth_plans: { label: "Growth plans", what: "Coach's focus areas and exercises." },
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
    filename: `fork-trail-coach-export-${today.toISOString().slice(0, 10)}.json`,
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
