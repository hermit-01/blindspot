import type { Cell, Claim, Report, ScoredCell } from "./types";

/**
 * The Unmet Need Score.
 *
 * A cell with no reports is NOT scored zero - that is the whole point of the
 * product. Silence is scored at its maximum, because "nobody has looked" is a
 * worse state to be in than "someone looked and it was fine".
 */
const WEIGHTS = {
  people: 0.3,
  severity: 0.25,
  silence: 0.3,
  access: 0.15,
};

/** Beyond this many hours without contact, staleness is maxed out. */
const SILENCE_CEILING_HOURS = 96;
const POP_CEILING = 8000;

/** A report only counts as verified coverage above this confidence. */
export const VERIFIED_AT = 0.7;
/** Coverage older than this stops counting as "served". */
const COVERAGE_HALF_LIFE_HOURS = 48;

export function scoreCells(
  cells: Cell[],
  reports: Report[],
  claims: Claim[],
  now: number
): ScoredCell[] {
  const live = reports.filter((r) => !r.mergedInto);

  const byCell = new Map<string, Report[]>();
  for (const r of live) {
    if (!r.cell) continue;
    const list = byCell.get(r.cell) ?? [];
    list.push(r);
    byCell.set(r.cell, list);
  }

  const claimByCell = new Map(claims.map((c) => [c.cell, c]));

  return cells.map((cell) => {
    const mine = byCell.get(cell.h3) ?? [];

    // Contact is anything we heard. Coverage is only a delivery we believe.
    // A village telling us it is cut off is contact, and it must not clear the
    // gap it is reporting.
    const covering = mine.filter(
      (r) => r.kind === "delivery" && r.confidence >= VERIFIED_AT
    );

    const lastAt = mine.length ? Math.max(...mine.map((r) => r.at)) : null;
    const hoursSinceContact =
      lastAt === null ? null : (now - lastAt) / 3600_000;

    const lastCoveredAt = covering.length
      ? Math.max(...covering.map((r) => r.at))
      : null;
    const hoursSinceCoverage =
      lastCoveredAt === null ? null : (now - lastCoveredAt) / 3600_000;

    let state: ScoredCell["state"];
    if (mine.length === 0) {
      state = "unknown";
    } else if (
      hoursSinceCoverage !== null &&
      hoursSinceCoverage <= COVERAGE_HALF_LIFE_HOURS
    ) {
      state = "served";
    } else {
      state = "reported";
    }

    // Measured from the last delivery, not the last message: an unanswered
    // call for help must not push a place down the queue for being heard.
    const silence =
      hoursSinceCoverage === null
        ? 1
        : Math.min(hoursSinceCoverage / SILENCE_CEILING_HOURS, 1);

    const people = Math.min(cell.population / POP_CEILING, 1);

    const terms = {
      people: WEIGHTS.people * people * 100,
      severity: WEIGHTS.severity * cell.severity * 100,
      silence: WEIGHTS.silence * silence * 100,
      access: WEIGHTS.access * cell.access * 100,
    };

    const score =
      terms.people + terms.severity + terms.silence + terms.access;

    const claim = claimByCell.get(cell.h3) ?? null;

    return {
      ...cell,
      state,
      score: Number(score.toFixed(1)),
      hoursSinceContact:
        hoursSinceContact === null ? null : Number(hoursSinceContact.toFixed(1)),
      claim: claim && claim.expiresAt > now ? claim : null,
      reportCount: mine.length,
      terms: {
        people: Number(terms.people.toFixed(1)),
        severity: Number(terms.severity.toFixed(1)),
        silence: Number(terms.silence.toFixed(1)),
        access: Number(terms.access.toFixed(1)),
      },
    };
  });
}

/** The ranked view: worst gaps first, claimed cells pushed to the bottom. */
export function rankGaps(scored: ScoredCell[]): ScoredCell[] {
  return [...scored].sort((a, b) => {
    if (Boolean(a.claim) !== Boolean(b.claim)) return a.claim ? 1 : -1;
    return b.score - a.score;
  });
}
