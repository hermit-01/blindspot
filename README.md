# Blindspot

**The relief map that shows you what nobody has reported.**

Manipal Hackathon 2026 · Round 1 · Team Newbiezz
Problem statement 17 — *Coordination gaps in disaster relief response*
Track: Disaster Relief & Crisis Response · SDG 11

---

## The idea in one paragraph

After a flood or a landslide, agencies, NGOs and volunteer groups deploy where
access is easiest and where reports are loudest. Every coordination tool in use
today maps **activity** — and an activity map can never show you a village
nobody has visited, because a place with no reports produces no pins. The
communities most likely to be missed are exactly the ones least able to report
that they were missed.

Blindspot inverts the map. It tiles the district into hexagonal cells, scores
each on how *unserved* it is, and makes the ranked list of gaps the primary
view. The move that makes it work is a third state: every other tool has
`served` and `needs help`; Blindspot adds **`unknown`**, and refuses to let it
look safe.

## What actually runs in this repo

Open <http://localhost:3000> after `npm install && npm run dev`.

| Beat | What to do | What happens |
| --- | --- | --- |
| The inverted map | — | 545 of 554 cells are `unknown`, hatched as voids. The 12 the list ranks are picked out; the rest are fog. |
| Reconciliation | Click sample 1, **Log it**. Then sample 2, **Log it**. | Sample 1 logs against Vellarimala, which drops off the gap list. Sample 2 is the same delivery spelled wrong by another agency — it folds into the first record and **the tally does not move**. |
| Commitment ledger | Select the top gap, **We are going here**. Switch agency. | The cell leaves the queue into *Someone is on the way*; the other agency sees it as taken and cannot claim it. |

`Reset demo` in the top right restores the seeded state.

### The three pieces

- **`lib/gap.ts` — the Gap Engine.** Unmet Need Score from people at risk,
  severity, silence and access difficulty. A cell with no reports is *not*
  scored zero; silence is scored at maximum, because "nobody has looked" is
  worse than "someone looked and it was fine". The score's components are
  returned with it so the UI can explain any ranking. Coverage is only ever
  earned by a **delivery**: a village reporting that it is cut off is contact,
  not care, and the silence term is measured from the last delivery so that
  being heard never costs a place its position in the queue.
- **`lib/reconcile.ts` — the Reconciliation Layer.** Resolves free text to a
  cell by fuzzy name match (Levenshtein, tolerance scaled to word length), picks
  out resource and quantity, and scores confidence by how much it could actually
  read. Two reports of the same resource in the same cell within six hours are
  treated as one event; corroboration from a *different* agency raises
  confidence more than the same agency repeating itself.
- **`lib/store.ts` — the Commitment Ledger.** Claims are public, expire after
  12 hours, and block other agencies rather than silently double-booking.

## Prototype versus production architecture

This is a Round 1 prototype built to be demonstrated, not deployed. Being
precise about the difference:

| | This repo | Production design |
| --- | --- | --- |
| Storage | In-memory, one process (`lib/store.ts`) | PostgreSQL + PostGIS for cells and reports |
| Live claim state | Same in-memory store | Redis, with TTL on claims |
| Intake | Paste box in the browser | The same `reconcile()` behind a WhatsApp/SMS webhook and CSV upload |
| Cells | Generated at boot from a traced district outline | Precomputed and stored, real admin boundaries |
| Auth | A role dropdown | Real agency accounts |

`lib/store.ts` is the seam: nothing above it knows the data is in memory.

## Data honesty

Everything here is **synthetic or approximate**, and none of it should be read
as a description of the real 2024 Wayanad response.

- The district outline is hand-traced and is not a survey boundary.
- Cell population is generated, tuned so the district totals roughly 886,000 —
  in the region of Wayanad's real ~817,000 — rather than an arbitrary number.
- Severity is modelled as distance from the landslide corridor.
- The 12 seeded reports are invented.
- Locality names and coordinates are real places.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · [h3-js](https://h3geo.org)
for the hex grid · OpenStreetMap raster tiles · Public Sans + IBM Plex Mono.

The map is **maplibre-gl 6.9.0**, pinned exactly. Getting it working took a
diagnosis worth writing down: v6 no longer inlines its web worker, and resolves
the worker URL from `import.meta.url`, which under any bundler is not an
`http(s)` URL — so the lookup returns `""` and no worker is ever constructed.
GeoJSON is parsed in that worker and raster tiles are not, which is why the
basemap drew and the hexes never did, silently, with nothing in the console
because nothing was attempted. The v5→v6 migration guide says it plainly:
`setWorkerUrl()` is bundler-only.

So `maplibre-gl-worker.mjs` and its sibling chunk are committed to
`public/maplibre/` and `setWorkerUrl` points at them. Both files are needed —
the worker is a *module* worker and imports the shared chunk as a sibling — and
the version is pinned because the two share a minified internal contract.

`components/MapPanel.tsx` is the earlier hand-projected SVG map, kept as a
working fallback at **`/?map=svg`**: the view never pans or zooms, so
projecting the hexes to Web Mercator is about forty lines. It needs no worker
and no WebGL, which makes it the safety net if a demo machine can't run GL.

## Layout

```
app/
  page.tsx            the console: gap list, map panel, report box
  api/state           GET  current snapshot
  api/report          POST free text -> reconciled report
  api/claim           POST claim / release / reset
lib/
  gap.ts              Unmet Need Score and ranking
  reconcile.ts        name resolution, dedupe, confidence
  seed.ts             district outline, cell generation, seeded reports
  store.ts            in-memory state and the actions over it
components/
  MapPanelGL.tsx      the map: maplibre over OSM raster tiles
  MapPanel.tsx        hand-projected SVG fallback, at /?map=svg
public/maplibre/      maplibre's worker + shared chunk, served to setWorkerUrl
scripts/
  check-coverage-rules.mjs   the coverage rules, checked end to end
```

## Checks

With the dev server running:

```
node scripts/check-coverage-rules.mjs
```

Four rules, because "covered" is the one claim the whole product rests on: a
delivery covers a cell, **a report of unmet need does not**, asking for help
must not push a cell down the queue, and the same delivery reported twice is
counted once.
