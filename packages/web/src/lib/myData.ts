import { STORED_KINDS, type MyDataResponse, type StoredKind } from "@ftc/shared";

/** What each kind of record is, in the words the "My data" page uses. */
export const KIND_INFO: Record<StoredKind, { label: string; what: string }> = {
  tickets: {
    label: "Tickets",
    what: "The tickets Fork has read.",
  },
  assumptions: {
    label: "Questions and assumptions",
    what: "What Fork asked about each ticket, and whether the PO answered or the developer assumed.",
  },
  decisions: {
    label: "Decisions",
    what: "Choices made while coding a ticket, and who made each one.",
  },
  pointers: {
    label: "Code pointers",
    what: "Where each decision lives: file, function and line. Never the code itself.",
  },
  explain_backs: {
    label: "Explain-backs",
    what: "Your own explanations of decisions, each with a rating.",
  },
  observations: {
    label: "Observations",
    what: "Notes about your skills, each tied to the decisions it rests on.",
  },
  growth_plans: {
    label: "Growth plans",
    what: "Coach's focus areas and exercises.",
  },
  annotations: {
    label: "Your notes",
    what: "Notes you added to a growth plan, including where you disagreed.",
  },
};

export function countRecords(response: MyDataResponse): Record<StoredKind, number> {
  return Object.fromEntries(
    STORED_KINDS.map((kind) => [kind, response.data[kind].length]),
  ) as Record<StoredKind, number>;
}

export function totalRecords(response: MyDataResponse): number {
  return STORED_KINDS.reduce((sum, kind) => sum + response.data[kind].length, 0);
}

export interface ExportFile {
  filename: string;
  text: string;
}

/** The export is the page's own data, unchanged, so the file matches what is shown. */
export function buildExport(response: MyDataResponse, today: Date = new Date()): ExportFile {
  const day = today.toISOString().slice(0, 10);
  return {
    filename: `ftc-data-${day}.json`,
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
