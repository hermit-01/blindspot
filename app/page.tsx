"use client";

import dynamicImport from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Snapshot } from "@/lib/store";
import { AGENCIES, type Agency, type ScoredCell } from "@/lib/types";

const MapPanel = dynamicImport(() => import("@/components/MapPanel"), {
  ssr: false,
});

// maplibre draws the map. The hand-drawn SVG panel above is kept as a working
// fallback - ?map=svg switches to it if anything goes wrong with WebGL on the
// day. See components/MapPanelGL.tsx for why maplibre needs setWorkerUrl here.
const MapPanelGL = dynamicImport(() => import("@/components/MapPanelGL"), {
  ssr: false,
});

/*
 * The demo, in three clicks. Vellarimala is top of the gap list and has no
 * reports at all, so the first sample moves it off the list entirely, and the
 * second - the same delivery, spelled wrong by a different agency - folds into
 * the first instead of counting twice.
 */
const SAMPLES = [
  "Vellarimala - 200 food kits delivered this morning",
  "vellarimalla village, foodkits 200 given",
  "Thariode cut off, need water and tarpaulin",
];

function ago(hours: number | null): string {
  if (hours === null) return "no contact on record";
  if (hours < 1) return "contact under an hour ago";
  if (hours < 24) return `last contact ${Math.round(hours)}h ago`;
  return `last contact ${Math.floor(hours / 24)}d ago`;
}

export default function Page() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [agency, setAgency] = useState<Agency>("District EOC");
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [merged, setMerged] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Both panels are ssr:false, so the server renders neither and reading the
  // query string in the initialiser cannot desync hydration.
  const [useSvgMap] = useState(
    () =>
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("map") === "svg",
  );
  const listRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/state", { cache: "no-store" });
    setSnap(await res.json());
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const ranked = snap?.ranked ?? [];
  const gaps = useMemo(
    () => ranked.filter((c) => c.state !== "served" && !c.claim).slice(0, 40),
    [ranked]
  );
  // Claimed cells leave the queue but stay on screen, so you can see a claim
  // land instead of watching a row vanish into position 548.
  const taken = useMemo(() => ranked.filter((c) => c.claim), [ranked]);
  const current: ScoredCell | null = useMemo(
    () => ranked.find((c) => c.h3 === selected) ?? null,
    [ranked, selected]
  );

  async function send(path: string, body: unknown) {
    setBusy(true);
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.state) setSnap(data.state);
      setNote(data.message ?? null);
      return data;
    } finally {
      setBusy(false);
    }
  }

  async function logReport() {
    if (!draft.trim()) return;
    const data = await send("/api/report", { raw: draft, agency });
    setMerged(Boolean(data.mergedWithId));
    if (data.cell) {
      setSelected(data.cell);
      setFlash(data.cell);
      setTimeout(() => setFlash(null), 1500);
    }
    setDraft("");
  }

  return (
    <div className="shell">
      <header className="bar">
        <span className="wordmark">Blindspot</span>
        <span className="situation">Wayanad district, day 4 of response</span>
        <div className="barRight">
          <span className="who">Reporting as</span>
          <select
            className="role"
            value={agency}
            onChange={(e) => setAgency(e.target.value as Agency)}
            aria-label="Reporting as"
          >
            {AGENCIES.map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
          <button
            className="reset"
            onClick={async () => {
              await send("/api/claim", { reset: true });
              setSelected(null);
              setNote("Demo reset.");
            }}
          >
            Reset demo
          </button>
        </div>
      </header>

      <div className="main">
        <div className="list" ref={listRef}>
          <div className="listHead">
            <h1>Where nobody has gone</h1>
            <p>
              Ranked by how many people are cut off, how bad it is there, how
              long since anyone confirmed anything, and how hard it is to reach.
            </p>
          </div>

          <div className="tally">
            <span className="tallyItem">
              <i className="swatch unknown" />
              <b className="num">{snap?.counts.unknown ?? 0}</b> nobody has
              looked
            </span>
            <span className="tallyItem">
              <i className="swatch reported" />
              <b className="num">{snap?.counts.reported ?? 0}</b> reported, going
              stale
            </span>
            <span className="tallyItem">
              <i className="swatch served" />
              <b className="num">{snap?.counts.served ?? 0}</b> covered
            </span>
            <span className="tallyItem">
              <b className="num">
                {(snap?.peopleInUnknown ?? 0).toLocaleString("en-IN")}
              </b>
              people live in cells nobody has reported on
            </span>
          </div>

          {gaps.map((cell, i) => (
            <button
              key={cell.h3}
              className={`row${flash === cell.h3 ? " absorbed" : ""}`}
              data-state={cell.state}
              aria-selected={cell.h3 === selected}
              onClick={() => setSelected(cell.h3)}
            >
              <span className="rank num">{i + 1}</span>
              <span>
                <span className={`place${cell.named ? "" : " grid"}`}>
                  {cell.name}
                </span>
                <span className="why">
                  {cell.population.toLocaleString("en-IN")} people ·{" "}
                  {ago(cell.hoursSinceContact)}
                </span>
                {cell.claim && (
                  <span className="claimed">
                    {cell.claim.agency} is going
                  </span>
                )}
              </span>
              <span className="score num">{Math.round(cell.score)}</span>
            </button>
          ))}

          {taken.length > 0 && (
            <>
              <p className="groupLabel">Someone is on the way</p>
              {taken.map((cell) => (
                <button
                  key={cell.h3}
                  className="row"
                  data-state={cell.state}
                  aria-selected={cell.h3 === selected}
                  onClick={() => setSelected(cell.h3)}
                >
                  <span className="rank num">—</span>
                  <span>
                    <span className={`place${cell.named ? "" : " grid"}`}>
                      {cell.name}
                    </span>
                    <span className="why">
                      {cell.population.toLocaleString("en-IN")} people ·{" "}
                      {ago(cell.hoursSinceContact)}
                    </span>
                    <span className="claimed">
                      {cell.claim?.agency} is going
                    </span>
                  </span>
                  <span className="score num">{Math.round(cell.score)}</span>
                </button>
              ))}
            </>
          )}
        </div>

        <div className="mapWrap">
          {useSvgMap ? (
            <MapPanel
              cells={ranked}
              outline={snap?.outline ?? []}
              selected={selected}
              onSelect={setSelected}
            />
          ) : (
            <MapPanelGL
              cells={ranked}
              outline={snap?.outline ?? []}
              selected={selected}
              onSelect={setSelected}
            />
          )}
          <span className="attribution">© OpenStreetMap contributors</span>

          {current && (
            <aside className="detail">
              <h2>{current.name}</h2>
              <p className="detailState">
                {current.state === "unknown"
                  ? "Nobody has reported from here"
                  : current.state === "served"
                    ? "Covered recently"
                    : "Reported, but going stale"}{" "}
                · {ago(current.hoursSinceContact)}
              </p>

              <div className="terms">
                <div className="term">
                  <span>People cut off</span>
                  <span className="num">
                    {current.population.toLocaleString("en-IN")}
                  </span>
                </div>
                <div className="term">
                  <span>Silence</span>
                  <span className="num">+{current.terms.silence}</span>
                </div>
                <div className="term">
                  <span>Severity</span>
                  <span className="num">+{current.terms.severity}</span>
                </div>
                <div className="term">
                  <span>People</span>
                  <span className="num">+{current.terms.people}</span>
                </div>
                <div className="term">
                  <span>Hard to reach</span>
                  <span className="num">+{current.terms.access}</span>
                </div>
                <div className="term">
                  <span>
                    <b>Unmet need</b>
                  </span>
                  <span className="num">
                    <b>{Math.round(current.score)}</b>
                  </span>
                </div>
              </div>

              {current.claim && current.claim.agency !== agency ? (
                <button className="claimBtn" disabled>
                  {current.claim.agency} is going here
                </button>
              ) : (
                <button
                  className={`claimBtn${current.claim ? " release" : ""}`}
                  disabled={busy}
                  onClick={() =>
                    send("/api/claim", { cell: current.h3, agency })
                  }
                >
                  {current.claim ? "Release this cell" : "We are going here"}
                </button>
              )}
            </aside>
          )}
        </div>
      </div>

      <div className="log">
        <div>
          <label htmlFor="raw">
            Log a report the way it actually arrives
          </label>
          <textarea
            id="raw"
            value={draft}
            placeholder="Chooralmala — 150 tarpaulins handed out"
            onChange={(e) => setDraft(e.target.value)}
          />
          <div className="samples">
            {SAMPLES.map((s) => (
              <button key={s} className="sample" onClick={() => setDraft(s)}>
                {s}
              </button>
            ))}
          </div>
          {note && (
            <p className={`note${merged ? " merged" : ""}`}>{note}</p>
          )}
        </div>
        <div className="logSide">
          <button
            className="logBtn"
            onClick={logReport}
            disabled={busy || !draft.trim()}
          >
            Log it
          </button>
        </div>
      </div>
    </div>
  );
}
