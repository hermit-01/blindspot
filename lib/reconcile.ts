import type { Cell, Report, ReportKind, Resource } from "./types";

/**
 * Turning what a field volunteer actually typed into a record we can rank on.
 *
 * Everything here assumes the input is wrong in some way: misspelled, missing
 * a quantity, already reported by somebody else an hour ago.
 */

const RESOURCE_WORDS: [Resource, string[]][] = [
  ["food kits", ["food kit", "foodkit", "food", "ration", "dry ration", "meal"]],
  ["drinking water", ["water", "drinking water", "water can", "bottle"]],
  ["medicine", ["medicine", "medicines", "medical", "meds", "first aid"]],
  ["tarpaulin", ["tarpaulin", "tarp", "sheet", "shelter"]],
  ["blankets", ["blanket", "blankets", "bedding"]],
];

/** Same-cell, same-resource reports inside this window are the same event. */
const DUPLICATE_WINDOW_HOURS = 6;

const DELIVERY_WORDS = [
  "delivered",
  "delivery",
  "distributed",
  "handed",
  "given",
  "supplied",
  "dropped",
  "provided",
  "completed",
  "done",
];

const NEED_WORDS = [
  "need",
  "needs",
  "needed",
  "require",
  "requires",
  "required",
  "requesting",
  "request",
  "cut off",
  "cutoff",
  "stranded",
  "trapped",
  "marooned",
  "no water",
  "no food",
  "running out",
  "short of",
  "shortage",
  "urgent",
  "urgently",
  "help",
  "waiting",
  "pending",
];

export function normalise(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const curr = [i];
    for (let j = 1; j <= n; j++) {
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    prev = curr;
  }
  return prev[n];
}

export interface PlaceMatch {
  cell: string | null;
  said: string;
  /** 1 when the name was written exactly, lower when we had to stretch. */
  strength: number;
}

/**
 * Resolve free text to a cell by name similarity.
 *
 * We match on the settlement, then keep the CELL - not the name - because two
 * spellings of one village must land on the same record. "meppady" and
 * "Meppadi" are one place.
 */
export function resolvePlace(text: string, cells: Cell[]): PlaceMatch {
  const tokens = normalise(text).split(" ").filter((t) => t.length > 2);
  const named = cells.filter((c) => c.named);

  let best: { cell: string; said: string; strength: number } | null = null;

  for (const cell of named) {
    const target = normalise(cell.name);
    const targetTokens = target.split(" ");

    for (const token of tokens) {
      for (const part of targetTokens) {
        if (part.length < 4) continue;
        const distance = levenshtein(token, part);
        const tolerance = part.length <= 6 ? 1 : 2;
        if (distance > tolerance) continue;
        const strength = 1 - distance / (part.length + 1);
        if (!best || strength > best.strength) {
          best = { cell: cell.h3, said: token, strength };
        }
      }
    }
  }

  if (!best) return { cell: null, said: "", strength: 0 };
  return best;
}

export function resolveResource(text: string): Resource | null {
  const n = normalise(text);
  let best: { resource: Resource; length: number } | null = null;
  for (const [resource, words] of RESOURCE_WORDS) {
    for (const word of words) {
      if (n.includes(word) && (!best || word.length > best.length)) {
        best = { resource, length: word.length };
      }
    }
  }
  return best ? best.resource : null;
}

function saysAny(normalised: string, words: string[]): boolean {
  return words.some((w) => new RegExp(`\\b${w}\\b`).test(normalised));
}

/**
 * What the message is claiming.
 *
 * Need beats delivery when a message contains both. Counting an unserved place
 * as served is the one mistake this product exists to prevent, so anything
 * still asking for something is not coverage - "200 kits delivered, still need
 * water" leaves the cell open.
 */
export function resolveKind(text: string): ReportKind {
  const n = normalise(text);
  if (saysAny(n, NEED_WORDS)) return "need";
  if (saysAny(n, DELIVERY_WORDS)) return "delivery";
  return "unclear";
}

export function resolveQuantity(text: string): number | null {
  const match = normalise(text).match(/\b(\d{1,6})\b/);
  return match ? Number(match[1]) : null;
}

/** Confidence starts low and is earned by each field we could actually read. */
export function scoreConfidence(
  place: PlaceMatch,
  resource: Resource | null,
  quantity: number | null
): number {
  let c = 0.35;
  if (place.cell) c += 0.3 * place.strength;
  if (resource) c += 0.2;
  if (quantity !== null) c += 0.15;
  return Number(Math.min(c, 0.99).toFixed(2));
}

export interface Reconciled {
  report: Report;
  /** The earlier report this one was folded into, if any. */
  mergedWith: Report | null;
}

export function reconcile(
  raw: string,
  agency: Report["agency"],
  cells: Cell[],
  existing: Report[],
  now: number
): Reconciled {
  const place = resolvePlace(raw, cells);
  const resource = resolveResource(raw);
  const quantity = resolveQuantity(raw);

  const report: Report = {
    id: `r-${now}-${Math.random().toString(36).slice(2, 7)}`,
    raw: raw.trim(),
    agency,
    kind: resolveKind(raw),
    cell: place.cell,
    saidPlace: place.said,
    resource,
    quantity,
    at: now,
    confidence: scoreConfidence(place, resource, quantity),
    absorbed: [],
  };

  if (!report.cell || !report.resource) {
    return { report, mergedWith: null };
  }

  // Same place, same resource, recent enough: one event reported twice.
  const twin = existing
    .filter((r) => !r.mergedInto)
    // A request for water and a delivery of water are not the same event.
    .filter(
      (r) =>
        r.cell === report.cell &&
        r.resource === report.resource &&
        r.kind === report.kind
    )
    .filter((r) => (now - r.at) / 3600_000 <= DUPLICATE_WINDOW_HOURS)
    .sort((a, b) => b.at - a.at)[0];

  if (!twin) return { report, mergedWith: null };

  report.mergedInto = twin.id;
  twin.absorbed = [...twin.absorbed, report.id];
  // Two independent agencies reporting the same delivery is corroboration,
  // so the surviving record gets more trustworthy, not less.
  twin.confidence = Number(
    Math.min(0.99, twin.confidence + 0.08 * (twin.agency === agency ? 0.5 : 1)).toFixed(2)
  );
  twin.at = Math.max(twin.at, report.at);

  return { report, mergedWith: twin };
}
