"use client";

import { useEffect, useRef } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import type {
  Map as MlMap,
  GeoJSONSource,
  ExpressionSpecification,
} from "maplibre-gl";
import type { ScoredCell } from "@/lib/types";

/*
 * The same fixed-view map as MapPanel, drawn by maplibre-gl instead of by hand.
 *
 * maplibre v6 no longer inlines its web worker: it resolves the worker URL from
 * import.meta.url, which under any bundler is not an http(s) URL, so the lookup
 * returns "" and no worker is ever started. GeoJSON is parsed in that worker and
 * raster tiles are not, which is why the basemap drew and the hexes never did -
 * silently, with no error. setWorkerUrl below is the documented fix; the worker
 * and its sibling chunk are copied into public/maplibre/.
 */

const COLOUR = {
  served: "#8c978d",
  reported: "#a8801a",
  unknown: "#351c75",
  ink: "#191d19",
};

interface Props {
  cells: ScoredCell[];
  outline: [number, number][];
  selected: string | null;
  onSelect: (h3: string) => void;
}

/*
 * A 45-degree hatch, drawn into a canvas because maplibre fills with bitmaps.
 * Lines of slope 1 spaced by size/n tile seamlessly on a square of side size,
 * since shifting by (size, size) maps the tile onto itself.
 */
function hatch(size: number, step: number, width: number, alpha: number) {
  const ratio = 2;
  const c = document.createElement("canvas");
  c.width = size * ratio;
  c.height = size * ratio;
  const ctx = c.getContext("2d")!;
  ctx.scale(ratio, ratio);
  ctx.strokeStyle = COLOUR.unknown;
  ctx.globalAlpha = alpha;
  ctx.lineWidth = width;
  for (let o = -size; o <= size * 2; o += step) {
    ctx.beginPath();
    ctx.moveTo(-size, -size + o);
    ctx.lineTo(size * 2, size * 2 + o);
    ctx.stroke();
  }
  return {
    width: c.width,
    height: c.height,
    data: new Uint8Array(
      ctx.getImageData(0, 0, c.width, c.height).data.buffer,
    ),
  };
}

function toFeatures(cells: ScoredCell[]) {
  // The cells the ranked list is actually pointing at. Everything else is fog:
  // 545 loud hexes is not a signal, it is wallpaper.
  const priority = new Set(
    cells
      .filter((c) => c.state !== "served" && !c.claim)
      .slice(0, 12)
      .map((c) => c.h3),
  );

  return {
    type: "FeatureCollection" as const,
    features: cells.map((cell) => ({
      type: "Feature" as const,
      id: cell.h3,
      properties: {
        h3: cell.h3,
        name: cell.name,
        state: cell.state,
        top: priority.has(cell.h3),
        claimed: Boolean(cell.claim),
      },
      geometry: {
        type: "Polygon" as const,
        coordinates: [cell.boundary],
      },
    })),
  };
}

/*
 * Frame the district. The map can mount before /api/state answers, so this is
 * called again the first time cells actually arrive - otherwise a slow response
 * leaves the demo looking at the whole world.
 */
function fitTo(map: MlMap, cells: ScoredCell[]): boolean {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const cell of cells) {
    for (const [lng, lat] of cell.boundary) {
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  }
  if (!Number.isFinite(minLng)) return false;
  map.fitBounds(
    [
      [minLng, minLat],
      [maxLng, maxLat],
    ],
    { padding: 26, animate: false },
  );
  return true;
}

function toOutline(outline: [number, number][]) {
  return {
    type: "FeatureCollection" as const,
    features: outline.length
      ? [
          {
            type: "Feature" as const,
            properties: {},
            geometry: { type: "LineString" as const, coordinates: outline },
          },
        ]
      : [],
  };
}

export default function MapPanelGL({
  cells,
  outline,
  selected,
  onSelect,
}: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const readyRef = useRef(false);
  const fittedRef = useRef(false);
  // Handlers change every render; keep the map's copy current without rebinding.
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;

  useEffect(() => {
    let cancelled = false;
    let map: MlMap | null = null;

    (async () => {
      const ml = await import("maplibre-gl");
      if (cancelled || !container.current) return;

      ml.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

      map = new ml.Map({
        container: container.current,
        style: {
          version: 8,
          sources: {
            osm: {
              type: "raster",
              tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
              tileSize: 256,
            },
          },
          layers: [
            {
              id: "osm",
              type: "raster",
              source: "osm",
              // Basemap is context, not content - drain it and let the hexes
              // carry colour. Mirrors the CSS filter on the SVG map's tiles.
              paint: {
                "raster-saturation": -0.97,
                "raster-contrast": -0.1,
                "raster-opacity": 0.46,
              },
            },
          ],
        },
        attributionControl: false,
        interactive: true,
      });
      mapRef.current = map;
      map.on("error", (e) => console.error("[gl] map error:", e.error?.message));
      // Debug handle: lets the map be inspected from the console during a demo
      // without wiring a dev-only build. Harmless in production.
      (window as unknown as Record<string, unknown>).__glmap = map;

      // The view never pans or zooms - it is a fixed frame, like the SVG one.
      map.dragPan.disable();
      map.scrollZoom.disable();
      map.doubleClickZoom.disable();
      map.touchZoomRotate.disable();
      map.dragRotate.disable();
      map.keyboard.disable();

      fittedRef.current = fitTo(map, cells);

      map.on("load", () => {
        if (!map) return;

        map.addImage("void", hatch(18, 9, 1, 0.11), { pixelRatio: 2 });
        map.addImage("voidTop", hatch(20, 5, 1.6, 0.62), { pixelRatio: 2 });

        map.addSource("cells", {
          type: "geojson",
          data: toFeatures(cells),
          promoteId: "h3",
        });
        map.addSource("outline", { type: "geojson", data: toOutline(outline) });

        const hover: ExpressionSpecification = [
          "boolean",
          ["feature-state", "hover"],
          false,
        ];

        map.addLayer({
          id: "cells-fill",
          type: "fill",
          source: "cells",
          filter: ["!=", ["get", "state"], "unknown"],
          paint: {
            "fill-color": [
              "match",
              ["get", "state"],
              "served",
              COLOUR.served,
              "reported",
              COLOUR.reported,
              COLOUR.served,
            ],
            "fill-opacity": [
              "case",
              hover,
              0.6,
              ["match", ["get", "state"], "served", 0.45, 0.38],
            ],
          },
        });

        /*
         * Unknown cells are hatched rather than filled, so the basemap shows
         * through: an unreported place reads as a hole in the coverage, not as
         * one more coloured area.
         */
        map.addLayer({
          id: "cells-hatch",
          type: "fill",
          source: "cells",
          filter: ["==", ["get", "state"], "unknown"],
          paint: {
            "fill-pattern": ["case", ["get", "top"], "voidTop", "void"],
            "fill-opacity": ["case", hover, 0.6, 1],
          },
        });

        map.addLayer({
          id: "cells-line",
          type: "line",
          source: "cells",
          paint: {
            "line-color": [
              "case",
              ["get", "top"],
              COLOUR.unknown,
              [
                "match",
                ["get", "state"],
                "served",
                COLOUR.served,
                "reported",
                COLOUR.reported,
                COLOUR.unknown,
              ],
            ],
            "line-width": [
              "case",
              ["get", "top"],
              2.2,
              ["==", ["get", "state"], "unknown"],
              0.35,
              0.7,
            ],
            // 545 outlined hexes read as wallpaper. Only the twelve the list
            // points at get a line anyone is meant to see.
            "line-opacity": [
              "case",
              ["get", "top"],
              0.95,
              ["==", ["get", "state"], "unknown"],
              0.14,
              0.65,
            ],
          },
        });

        map.addLayer({
          id: "cells-claim",
          type: "line",
          source: "cells",
          filter: ["==", ["get", "claimed"], true],
          paint: {
            "line-color": COLOUR.ink,
            "line-width": 2.2,
            "line-dasharray": [3, 2],
          },
        });

        map.addLayer({
          id: "outline-line",
          type: "line",
          source: "outline",
          paint: {
            "line-color": COLOUR.ink,
            "line-width": 1.8,
            "line-opacity": 0.4,
          },
        });

        map.addLayer({
          id: "cells-selected",
          type: "line",
          source: "cells",
          filter: ["==", ["get", "h3"], selected ?? ""],
          paint: { "line-color": COLOUR.ink, "line-width": 3.4 },
        });

        let hovered: string | null = null;
        const setHover = (id: string | null) => {
          if (hovered === id || !map) return;
          if (hovered !== null) {
            map.setFeatureState(
              { source: "cells", id: hovered },
              { hover: false },
            );
          }
          hovered = id;
          if (id !== null) {
            map.setFeatureState({ source: "cells", id }, { hover: true });
          }
        };

        for (const layer of ["cells-fill", "cells-hatch"]) {
          map.on("mousemove", layer, (e) => {
            if (!map) return;
            map.getCanvas().style.cursor = "pointer";
            const id = e.features?.[0]?.properties?.h3 as string | undefined;
            setHover(id ?? null);
          });
          map.on("mouseleave", layer, () => {
            if (!map) return;
            map.getCanvas().style.cursor = "";
            setHover(null);
          });
          map.on("click", layer, (e) => {
            const id = e.features?.[0]?.properties?.h3 as string | undefined;
            if (id) selectRef.current(id);
          });
        }

        readyRef.current = true;
      });
    })();

    return () => {
      cancelled = true;
      readyRef.current = false;
      fittedRef.current = false;
      mapRef.current = null;
      map?.remove();
    };
    // Built once; data changes are pushed through setData below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    if (!fittedRef.current) fittedRef.current = fitTo(map, cells);
    (map.getSource("cells") as GeoJSONSource | undefined)?.setData(
      toFeatures(cells),
    );
    (map.getSource("outline") as GeoJSONSource | undefined)?.setData(
      toOutline(outline),
    );
  }, [cells, outline]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    map.setFilter("cells-selected", ["==", ["get", "h3"], selected ?? ""]);
  }, [selected]);

  return (
    <div
      ref={container}
      className="map"
      role="img"
      aria-label="Relief coverage across Wayanad district"
    />
  );
}
