"use client";

import { useMemo } from "react";
import type { ScoredCell } from "@/lib/types";

/*
 * A fixed-view map drawn as SVG over OpenStreetMap raster tiles.
 *
 * There is no WebGL map engine here on purpose. The view never pans or zooms,
 * so all a map library buys is a worker, a GL context and a version risk -
 * and maplibre's GeoJSON sources rendered nothing at all in this setup, under
 * both Turbopack and webpack. Projecting the hexes ourselves is about forty
 * lines, renders identically every time, and lets the unknown cells use a real
 * SVG hatch instead of a generated bitmap pattern.
 */

const TILE = 256;
const Z = 11;

const COLOUR = {
  served: "#78857a",
  reported: "#8f6a12",
  unknown: "#351c75",
  ink: "#221d14",
};

function lngToPx(lng: number): number {
  return ((lng + 180) / 360) * TILE * 2 ** Z;
}

function latToPx(lat: number): number {
  const s = Math.sin((lat * Math.PI) / 180);
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * TILE * 2 ** Z;
}

function project(p: [number, number]): [number, number] {
  return [lngToPx(p[0]), latToPx(p[1])];
}

function pointsOf(ring: [number, number][]): string {
  return ring.map((p) => project(p).join(",")).join(" ");
}

interface Props {
  cells: ScoredCell[];
  outline: [number, number][];
  selected: string | null;
  onSelect: (h3: string) => void;
}

export default function MapPanel({ cells, outline, selected, onSelect }: Props) {
  const view = useMemo(() => {
    if (!cells.length) return null;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const cell of cells) {
      for (const point of cell.boundary) {
        const [x, y] = project(point);
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }

    const pad = 14;
    minX -= pad;
    minY -= pad;
    maxX += pad;
    maxY += pad;

    // Widen the box to roughly the shape of the panel it sits in, so the
    // basemap fills the frame instead of leaving bands of paper either side.
    const TARGET_ASPECT = 1.85;
    const w = maxX - minX;
    const h = maxY - minY;
    if (w / h < TARGET_ASPECT) {
      const grow = (h * TARGET_ASPECT - w) / 2;
      minX -= grow;
      maxX += grow;
    } else {
      const grow = (w / TARGET_ASPECT - h) / 2;
      minY -= grow;
      maxY += grow;
    }

    const tiles: { key: string; x: number; y: number; url: string }[] = [];
    const x0 = Math.floor(minX / TILE);
    const x1 = Math.floor(maxX / TILE);
    const y0 = Math.floor(minY / TILE);
    const y1 = Math.floor(maxY / TILE);
    for (let tx = x0; tx <= x1; tx++) {
      for (let ty = y0; ty <= y1; ty++) {
        tiles.push({
          key: `${tx}-${ty}`,
          x: tx * TILE,
          y: ty * TILE,
          url: `https://tile.openstreetmap.org/${Z}/${tx}/${ty}.png`,
        });
      }
    }

    return {
      box: `${minX} ${minY} ${maxX - minX} ${maxY - minY}`,
      tiles,
    };
  }, [cells]);

  // The cells the ranked list is actually pointing at. Everything else is fog:
  // 545 loud hexes is not a signal, it is wallpaper.
  const priority = useMemo(
    () =>
      new Set(
        cells
          .filter((c) => c.state !== "served" && !c.claim)
          .slice(0, 12)
          .map((c) => c.h3)
      ),
    [cells]
  );

  if (!view) return <div className="map" />;

  return (
    <svg
      className="map"
      viewBox={view.box}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="Relief coverage across Wayanad district"
    >
      <defs>
        {/*
         * Unknown cells are hatched rather than filled, so the basemap shows
         * through: an unreported place reads as a hole in the coverage, not as
         * one more coloured area.
         */}
        <pattern
          id="void"
          width="9"
          height="9"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <line
            x1="0"
            y1="0"
            x2="0"
            y2="9"
            stroke={COLOUR.unknown}
            strokeWidth="1"
            opacity="0.16"
          />
        </pattern>
        {/* The same hatch, dense, for the handful of gaps actually worth acting on. */}
        <pattern
          id="voidTop"
          width="6"
          height="6"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <line
            x1="0"
            y1="0"
            x2="0"
            y2="6"
            stroke={COLOUR.unknown}
            strokeWidth="1.6"
            opacity="0.62"
          />
        </pattern>
      </defs>

      <g className="tiles">
        {view.tiles.map((t) => (
          <image
            key={t.key}
            href={t.url}
            x={t.x}
            y={t.y}
            width={TILE}
            height={TILE}
          />
        ))}
      </g>

      <g>
        {cells.map((cell) => {
          const unknown = cell.state === "unknown";
          const top = priority.has(cell.h3);
          return (
            <polygon
              key={cell.h3}
              points={pointsOf(cell.boundary)}
              fill={
                unknown
                  ? top
                    ? "url(#voidTop)"
                    : "url(#void)"
                  : cell.state === "served"
                    ? COLOUR.served
                    : COLOUR.reported
              }
              fillOpacity={unknown ? 1 : cell.state === "served" ? 0.45 : 0.38}
              stroke={
                top
                  ? COLOUR.unknown
                  : unknown
                    ? COLOUR.unknown
                    : COLOUR[cell.state]
              }
              strokeWidth={top ? 1.6 : unknown ? 0.25 : 0.45}
              strokeOpacity={top ? 0.95 : unknown ? 0.3 : 0.7}
              className="cell"
              onClick={() => onSelect(cell.h3)}
            >
              <title>{`${cell.name} — ${Math.round(cell.score)}`}</title>
            </polygon>
          );
        })}
      </g>

      <g>
        {cells
          .filter((c) => c.claim)
          .map((cell) => (
            <polygon
              key={`claim-${cell.h3}`}
              points={pointsOf(cell.boundary)}
              fill="none"
              stroke={COLOUR.ink}
              strokeWidth="1.2"
              strokeDasharray="3 2"
              pointerEvents="none"
            />
          ))}
      </g>

      {outline.length > 0 && (
        <polygon
          points={pointsOf(outline)}
          fill="none"
          stroke={COLOUR.ink}
          strokeWidth="1.4"
          strokeOpacity="0.45"
          pointerEvents="none"
        />
      )}

      {selected && (
        <polygon
          points={pointsOf(
            cells.find((c) => c.h3 === selected)?.boundary ?? []
          )}
          fill="none"
          stroke={COLOUR.ink}
          strokeWidth="2"
          pointerEvents="none"
        />
      )}
    </svg>
  );
}
