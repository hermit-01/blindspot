export type Agency = "District EOC" | "NGO-A" | "NGO-B";

export const AGENCIES: Agency[] = ["District EOC", "NGO-A", "NGO-B"];

/** What we know about a cell, which is not the same as what is true there. */
export type CellState = "served" | "reported" | "unknown";

export type Resource =
  | "food kits"
  | "drinking water"
  | "medicine"
  | "tarpaulin"
  | "blankets";

export interface Cell {
  h3: string;
  /** A locality name where we have one. Many cells genuinely have none. */
  name: string;
  /** True when `name` is a real place rather than a grid reference. */
  named: boolean;
  population: number;
  /** 0..1 - modelled from distance to the landslide corridor. */
  severity: number;
  /** 0..1 - higher means harder to physically reach. */
  access: number;
  centre: [number, number]; // [lng, lat]
  boundary: [number, number][];
}

export interface Report {
  id: string;
  raw: string;
  agency: Agency;
  /** h3 of the cell this report resolved to, or null if unresolvable. */
  cell: string | null;
  /** The place name as written by the reporter, before resolution. */
  saidPlace: string;
  resource: Resource | null;
  quantity: number | null;
  at: number; // epoch ms
  confidence: number; // 0..1
  /** Set when this report was folded into an earlier one. */
  mergedInto?: string;
  /** ids of reports folded into this one. */
  absorbed: string[];
}

export interface Claim {
  cell: string;
  agency: Agency;
  at: number;
  expiresAt: number;
}

export interface ScoredCell extends Cell {
  state: CellState;
  score: number;
  /** Hours since anyone verified anything here; null means never. */
  hoursSinceContact: number | null;
  claim: Claim | null;
  reportCount: number;
  /** The score's components, so the UI can explain the ranking. */
  terms: {
    people: number;
    severity: number;
    silence: number;
    access: number;
  };
}
