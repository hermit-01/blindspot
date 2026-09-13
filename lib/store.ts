import { rankGaps, scoreCells } from "./gap";
import { reconcile } from "./reconcile";
import { buildCells, districtOutline, seedReports } from "./seed";
import type { Agency, Claim, Report, ScoredCell } from "./types";

/**
 * Demo-scale state: one process, in memory.
 *
 * Production is PostgreSQL + PostGIS for the cells and reports and Redis for
 * live claim state - see the README. Nothing here depends on staying in memory;
 * the store interface is the seam.
 */

const CLAIM_TTL_HOURS = 12;

interface Db {
  reports: Report[];
  claims: Claim[];
  startedAt: number;
}

declare global {
  // Survives hot reload in dev, which otherwise resets the demo mid-sentence.
  var __blindspot: Db | undefined;
}

function db(): Db {
  if (!globalThis.__blindspot) {
    const now = Date.now();
    globalThis.__blindspot = {
      reports: seedReports(now),
      claims: [],
      startedAt: now,
    };
  }
  return globalThis.__blindspot;
}

export interface Snapshot {
  ranked: ScoredCell[];
  outline: [number, number][];
  reports: Report[];
  counts: { served: number; reported: number; unknown: number; total: number };
  peopleInUnknown: number;
}

export function snapshot(): Snapshot {
  const now = Date.now();
  const store = db();
  const scored = scoreCells(buildCells(), store.reports, store.claims, now);
  const ranked = rankGaps(scored);

  const counts = { served: 0, reported: 0, unknown: 0, total: scored.length };
  let peopleInUnknown = 0;
  for (const c of scored) {
    counts[c.state] += 1;
    if (c.state === "unknown") peopleInUnknown += c.population;
  }

  return {
    ranked,
    outline: districtOutline(),
    reports: [...store.reports].sort((a, b) => b.at - a.at),
    counts,
    peopleInUnknown,
  };
}

export interface LogResult {
  ok: boolean;
  message: string;
  reportId?: string;
  mergedWithId?: string;
  cell?: string;
}

export function logReport(raw: string, agency: Agency): LogResult {
  const text = raw.trim();
  if (!text) return { ok: false, message: "Nothing to log yet." };

  const store = db();
  const { report, mergedWith } = reconcile(
    text,
    agency,
    buildCells(),
    store.reports,
    Date.now()
  );
  store.reports.push(report);

  if (!report.cell) {
    return {
      ok: true,
      message: "Logged, but no place in this district matched. It will not move any ranking until someone resolves it.",
      reportId: report.id,
    };
  }

  const cell = buildCells().find((c) => c.h3 === report.cell);
  const where = cell?.name ?? "an unnamed cell";

  if (mergedWith) {
    return {
      ok: true,
      message: `Same delivery as an earlier report from ${mergedWith.agency}. Folded into one record for ${where}.`,
      reportId: report.id,
      mergedWithId: mergedWith.id,
      cell: report.cell,
    };
  }

  return {
    ok: true,
    message: `Logged against ${where}.`,
    reportId: report.id,
    cell: report.cell,
  };
}

export function claimCell(cell: string, agency: Agency): LogResult {
  const store = db();
  const now = Date.now();
  const held = store.claims.find((c) => c.cell === cell && c.expiresAt > now);
  const target = buildCells().find((c) => c.h3 === cell);
  const where = target?.name ?? "that cell";

  if (held && held.agency !== agency) {
    return { ok: false, message: `${held.agency} is already going to ${where}.` };
  }
  if (held) {
    store.claims = store.claims.filter((c) => c.cell !== cell);
    return { ok: true, message: `Released ${where}.`, cell };
  }

  store.claims.push({
    cell,
    agency,
    at: now,
    expiresAt: now + CLAIM_TTL_HOURS * 3600_000,
  });
  return {
    ok: true,
    message: `${agency} is going to ${where}. Everyone else sees it as taken.`,
    cell,
  };
}

export function resetDemo(): void {
  globalThis.__blindspot = undefined;
}
