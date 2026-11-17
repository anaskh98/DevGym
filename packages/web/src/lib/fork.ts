import type { Assumption } from "@ftc/shared";

export interface ForkSummary {
  total: number;
  answeredByPo: number;
  assumedByDev: number;
}

export function summarize(assumptions: readonly Pick<Assumption, "status">[]): ForkSummary {
  const answeredByPo = assumptions.filter((a) => a.status === "answered_by_po").length;
  return { total: assumptions.length, answeredByPo, assumedByDev: assumptions.length - answeredByPo };
}

export function plural(count: number, one: string, many: string = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}
