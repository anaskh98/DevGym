import { parseServerDate } from "@ftc/shared";
import { describe, expect, it } from "vitest";
import { apiHost, readApiConfig, resolveUrl } from "../src/api/config";
import { plural, summarize } from "../src/lib/fork";
import { parseBlocks } from "../src/lib/markdown";
import { pointerLabel, pointerState } from "../src/lib/pointer";

describe("API config", () => {
  it("defaults to the committed sample data", () => {
    const config = readApiConfig({ BASE_URL: "/" });
    expect(config.mode).toBe("mock");
    expect(resolveUrl(config, "/api/tickets")).toBe("/mock/api/tickets.json");
    expect(resolveUrl(config, "/api/tickets/SAMPLE-1")).toBe("/mock/api/tickets/SAMPLE-1.json");
  });

  it("in the plugin, calls the API on the address the app was loaded from", () => {
    const config = readApiConfig({ VITE_API_MODE: "live", VITE_API_BASE: "" });
    expect(resolveUrl(config, "/api/growth-plan")).toBe("/api/growth-plan");
  });

  it("in development, can call the service on another port", () => {
    const config = readApiConfig({ VITE_API_MODE: "live", VITE_API_BASE: "http://127.0.0.1:4317/" });
    expect(resolveUrl(config, "/api/tickets")).toBe("http://127.0.0.1:4317/api/tickets");
    expect(apiHost(config)).toBe("127.0.0.1:4317");
  });
});

describe("dates from the service", () => {
  it("reads the service's UTC timestamps as UTC", () => {
    expect(parseServerDate("2026-11-16 13:55:09").toISOString()).toBe("2026-11-16T13:55:09.000Z");
    expect(parseServerDate("2026-11-16T12:00:00.000Z").toISOString()).toBe("2026-11-16T12:00:00.000Z");
  });
});

describe("pointers", () => {
  const pointer = {
    url: "https://github.com/acme/shop/blob/abc1234/src/a.ts#L3",
    resolved: true as boolean | null,
    file_path: "src/a.ts",
    symbol: "run" as string | null,
    line_hint: 3 as number | null,
  };

  it("links when there is a GitHub URL and the last check did not fail", () => {
    expect(pointerState(pointer)).toBe("linked");
    expect(pointerState({ ...pointer, resolved: null })).toBe("linked");
  });

  it("is broken when the last check failed, and unlinked without a commit", () => {
    expect(pointerState({ ...pointer, resolved: false })).toBe("broken");
    expect(pointerState({ ...pointer, url: null })).toBe("unlinked");
    expect(pointerState({ ...pointer, url: "javascript:alert(1)" })).toBe("unlinked");
  });

  it("labels by function, then by line", () => {
    expect(pointerLabel(pointer)).toBe("src/a.ts, run");
    expect(pointerLabel({ ...pointer, symbol: null })).toBe("src/a.ts, line 3");
    expect(pointerLabel({ ...pointer, symbol: null, line_hint: null })).toBe("src/a.ts");
  });
});

describe("fork helpers", () => {
  it("counts answered and assumed", () => {
    expect(summarize([{ status: "answered_by_po" }, { status: "assumed_by_dev" }, { status: "assumed_by_dev" }])).toEqual({
      total: 3,
      answeredByPo: 1,
      assumedByDev: 2,
    });
    expect(plural(1, "question")).toBe("1 question");
    expect(plural(5, "question")).toBe("5 questions");
  });
});

describe("ticket markdown", () => {
  it("reads headings, lists and paragraphs, and returns text, never markup", () => {
    expect(parseBlocks("## Why\n\nOne line\nwrapped.\n\n- first\n- second\n")).toEqual([
      { type: "heading", level: 2, text: "Why" },
      { type: "paragraph", text: "One line wrapped." },
      { type: "list", items: ["first", "second"] },
    ]);
    expect(parseBlocks("<script>alert(1)</script>")).toEqual([{ type: "paragraph", text: "<script>alert(1)</script>" }]);
  });
});
