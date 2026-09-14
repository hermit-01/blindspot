import {
  cellToBoundary,
  cellToLatLng,
  gridDisk,
  latLngToCell,
  polygonToCells,
} from "h3-js";
import { resolveKind } from "./reconcile";
import type { Agency, Cell, Report, Resource } from "./types";

/**
 * Wayanad district, Kerala - the 2024 landslide response is the scenario.
 * The outline is a hand-traced approximation, good enough to tile; it is not a
 * survey boundary and the README says so.
 */
const DISTRICT: [number, number][] = [
  [11.96, 75.92],
  [11.98, 76.12],
  [11.88, 76.30],
  [11.78, 76.44],
  [11.62, 76.42],
  [11.50, 76.28],
  [11.45, 76.10],
  [11.52, 75.92],
  [11.72, 75.80],
];

/**
 * Resolution 7 - about 5 km² a cell, so roughly 400 across the district.
 * Resolution 6 collapses Chooralmala, Mundakkai and Meppadi into one cell,
 * which destroys the whole scenario.
 */
export const RESOLUTION = 7;

/** Where the slide came down. Severity falls off with distance from here. */
const EPICENTRE: [number, number] = [11.468, 76.135];

/** Localities we have names for. Everything else is a grid reference. */
const LOCALITIES: [string, number, number][] = [
  ["Meppadi", 11.548, 76.135],
  ["Chooralmala", 11.492, 76.118],
  ["Mundakkai", 11.478, 76.103],
  ["Attamala", 11.510, 76.090],
  ["Vellarimala", 11.520, 76.070],
  ["Puthumala", 11.560, 76.090],
  ["Kalpetta", 11.608, 76.083],
  ["Vythiri", 11.552, 76.040],
  ["Muppainad", 11.560, 76.180],
  ["Thariode", 11.630, 76.010],
  ["Padinjarathara", 11.700, 75.980],
  ["Kaniyambetta", 11.660, 76.060],
  ["Meenangadi", 11.660, 76.200],
  ["Ambalavayal", 11.620, 76.220],
  ["Sultan Bathery", 11.665, 76.261],
  ["Noolpuzha", 11.640, 76.330],
  ["Pulpally", 11.790, 76.170],
  ["Mananthavady", 11.802, 76.005],
  ["Panamaram", 11.740, 76.075],
  ["Thirunelly", 11.900, 76.030],
];

/** Deterministic PRNG so every run of the demo looks identical. */
function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function km(a: [number, number], b: [number, number]): number {
  const dLat = (a[0] - b[0]) * 110.9;
  const dLng = (a[1] - b[1]) * 109.0;
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

let cached: Cell[] | null = null;

export function buildCells(): Cell[] {
  if (cached) return cached;

  const indexes = polygonToCells(DISTRICT, RESOLUTION);

  // Name a cell after the locality inside it. Where two localities land on the
  // same cell, push the second to the nearest free neighbour rather than
  // dropping it - losing a village name loses a report later.
  const inDistrict = new Set(indexes);
  const namesByCell = new Map<string, string>();
  for (const [name, lat, lng] of LOCALITIES) {
    let idx = latLngToCell(lat, lng, RESOLUTION);
    if (namesByCell.has(idx) || !inDistrict.has(idx)) {
      const free = gridDisk(idx, 2).find(
        (n: string) => inDistrict.has(n) && !namesByCell.has(n)
      );
      if (!free) continue;
      idx = free;
    }
    namesByCell.set(idx, name);
  }

  const cells: Cell[] = indexes.map((h3, i) => {
    const rnd = mulberry32(hash(h3));
    const [lat, lng] = cellToLatLng(h3);
    const distance = km([lat, lng], EPICENTRE);

    // Close to the slide corridor is worse, with some noise so it is not a
    // clean bullseye.
    const severity = Math.max(
      0.05,
      Math.min(1, 1 - distance / 42 + (rnd() - 0.5) * 0.22)
    );

    // The east and the high ground are harder to reach.
    const access = Math.max(
      0.05,
      Math.min(1, 0.25 + (lng - 75.85) / 0.6 + (rnd() - 0.5) * 0.4)
    );

    const name = namesByCell.get(h3);
    // Synthetic, but it has to total something believable: Wayanad is about
    // 817,000 people, so named settlements carry a few thousand each and the
    // rural cells are skewed low. A district that adds up to millions would be
    // the first thing a judge from Kerala disbelieved.
    const population = name
      ? Math.round(2000 + rnd() * 8000)
      : Math.round(100 + Math.pow(rnd(), 2.2) * 4000);

    return {
      h3,
      name: name ?? `WYD-${String(i + 1).padStart(2, "0")}`,
      named: Boolean(name),
      population,
      severity: Number(severity.toFixed(3)),
      access: Number(access.toFixed(3)),
      centre: [lng, lat],
      boundary: cellToBoundary(h3, true) as [number, number][],
    };
  });

  cached = cells;
  return cells;
}

export function districtOutline(): [number, number][] {
  return DISTRICT.map(([lat, lng]) => [lng, lat]);
}

/**
 * Twelve reports already in the system when the demo opens - enough that a few
 * cells are covered and the rest are visibly untouched.
 */
export function seedReports(now: number): Report[] {
  const cells = buildCells();
  const byName = (n: string) => cells.find((c) => c.name === n)?.h3 ?? null;

  const rows: [string, Agency, Resource, number, number][] = [
    ["Meppadi", "District EOC", "food kits", 400, 3],
    ["Meppadi", "NGO-A", "drinking water", 900, 5],
    ["Chooralmala", "District EOC", "medicine", 120, 8],
    ["Chooralmala", "NGO-B", "tarpaulin", 150, 11],
    ["Mundakkai", "NGO-A", "food kits", 260, 14],
    ["Kalpetta", "District EOC", "blankets", 500, 20],
    ["Kalpetta", "NGO-B", "food kits", 300, 26],
    ["Vythiri", "NGO-A", "drinking water", 400, 33],
    ["Sultan Bathery", "District EOC", "food kits", 220, 47],
    ["Mananthavady", "NGO-B", "medicine", 80, 55],
    ["Ambalavayal", "NGO-A", "tarpaulin", 90, 70],
    ["Panamaram", "District EOC", "blankets", 140, 86],
  ];

  return rows.map(([place, agency, resource, quantity, hoursAgo], i) => ({
    id: `seed-${i + 1}`,
    raw: `${place} - ${quantity} ${resource} delivered`,
    agency,
    kind: resolveKind(`${place} - ${quantity} ${resource} delivered`),
    cell: byName(place),
    saidPlace: place,
    resource,
    quantity,
    at: now - hoursAgo * 3600_000,
    confidence: 0.92,
    absorbed: [],
  }));
}
