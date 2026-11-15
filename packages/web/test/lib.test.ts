import { describe, expect, it } from "vitest";
import { readApiConfig, resolveUrl } from "../src/api/config";
import { plural, summarize, takenReadingIndex } from "../src/lib/fork";
import { parseBlocks } from "../src/lib/markdown";
import { buildPointerUrl, pointerLabel } from "../src/lib/pointer";

describe("API config: mock to live is one setting", () => {
  it("defaults to the committed mock JSON", () => {
    const config = readApiConfig({ BASE_URL: "/" });
    expect(config.mode).toBe("mock");
    expect(resolveUrl(config, "/api/tickets")).toBe("/mock/api/tickets.json");
    expect(resolveUrl(config, "/api/tickets/DEMO-1/fork")).toBe("/mock/api/tickets/DEMO-1/fork.json");
  });

  it("calls the local API in live mode, with the same paths", () => {
    const config = readApiConfig({ VITE_API_MODE: "live", VITE_API_BASE: "http://127.0.0.1:4317/" });
    expect(resolveUrl(config, "/api/tickets/DEMO-1/fork")).toBe(
      "http://127.0.0.1:4317/api/tickets/DEMO-1/fork",
    );
  });

  it("can read an export of the developer's own database", () => {
    const config = readApiConfig({ BASE_URL: "./", VITE_MOCK_DIR: "/mock-local/" });
    expect(resolveUrl(config, "/api/tickets")).toBe("./mock-local/api/tickets.json");
  });
});

describe("pointer links", () => {
  const pointer = {
    repo: "md-labs/roomly",
    commit: "a1b2c3d",
    file_path: "src/bookings.ts",
    line_hint: 88,
    symbol: "cancelBooking",
  };

  it("builds a GitHub permalink to the line", () => {
    expect(buildPointerUrl(pointer)).toBe(
      "https://github.com/md-labs/roomly/blob/a1b2c3d/src/bookings.ts#L88",
    );
  });

  it("does not link when the repo or commit is unknown", () => {
    expect(buildPointerUrl({ ...pointer, commit: null })).toBeNull();
    expect(buildPointerUrl({ ...pointer, repo: null })).toBeNull();
    expect(buildPointerUrl({ ...pointer, repo: "evil.example/x/y" })).toBeNull();
  });

  it("keeps the path inside the repository and encodes it", () => {
    expect(buildPointerUrl({ ...pointer, file_path: "../../etc/my file.ts", line_hint: null })).toBe(
      "https://github.com/md-labs/roomly/blob/a1b2c3d/etc/my%20file.ts",
    );
  });

  it("labels by function, then by line", () => {
    expect(pointerLabel(pointer)).toBe("src/bookings.ts, cancelBooking");
    expect(pointerLabel({ ...pointer, symbol: null })).toBe("src/bookings.ts, line 88");
    expect(pointerLabel({ ...pointer, symbol: null, line_hint: null })).toBe("src/bookings.ts");
  });
});

describe("fork helpers", () => {
  const base = { id: "a", ticket_id: "T", run_id: "r", position: 0, text: "q", created_at: "" };

  it("counts answered and assumed", () => {
    const run = {
      run_id: "r",
      created_at: "",
      assumptions: [
        { ...base, readings: ["a", "b"], status: "answered_by_po" as const, answer: "a" },
        { ...base, readings: ["a", "b"], status: "assumed_by_dev" as const, answer: "b" },
        { ...base, readings: ["a", "b"], status: "assumed_by_dev" as const, answer: "b" },
      ],
    };
    expect(summarize(run)).toEqual({ total: 3, answeredByPo: 1, assumedByDev: 2 });
  });

  it("finds the reading that was taken only when the answer is that reading", () => {
    const readings = ["Refuse the request.", "Allow it, without a refund."];
    expect(takenReadingIndex({ readings, answer: "allow it without a refund" })).toBe(1);
    expect(takenReadingIndex({ readings, answer: "Allow it, but refund half." })).toBe(-1);
    expect(takenReadingIndex({ readings, answer: "" })).toBe(-1);
  });

  it("pluralises", () => {
    expect(plural(1, "question")).toBe("1 question");
    expect(plural(5, "question")).toBe("5 questions");
  });
});

describe("ticket markdown", () => {
  it("reads headings, lists and paragraphs", () => {
    expect(parseBlocks("## Why\n\nOne line\nwrapped.\n\n- first\n- second\n  continued\n")).toEqual([
      { type: "heading", level: 2, text: "Why" },
      { type: "paragraph", text: "One line wrapped." },
      { type: "list", items: ["first", "second continued"] },
    ]);
  });

  it("returns text, never markup", () => {
    const blocks = parseBlocks("<script>alert(1)</script>");
    expect(blocks).toEqual([{ type: "paragraph", text: "<script>alert(1)</script>" }]);
  });
});
