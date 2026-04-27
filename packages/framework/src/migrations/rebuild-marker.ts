// Rebuild-Marker-File: zur generate-Zeit schreibt der Migration-Generator
// ein Side-File `<tag>__rebuild.json` neben das SQL-File. Beim apply liest
// der Apply-Step die Marker für alle neu-applied Migrations und ruft
// rebuildProjection() für jede gelistete Projection.
//
// Format:
//   {
//     "schemaVersion": 1,
//     "migrationTag": "0042_brave_taskmaster",
//     "projections": ["publicstatus:projection:incident-state", ...]
//   }
//
// Das File wird zum Migration-File committed und durchläuft Code-Review
// — die Projection-Rebuild-Liste ist damit sichtbar im PR.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const MARKER_VERSION = 1 as const;

export type RebuildMarker = {
  readonly schemaVersion: typeof MARKER_VERSION;
  readonly migrationTag: string;
  readonly projections: readonly string[];
};

function markerPath(migrationsDir: string, migrationTag: string): string {
  return resolve(migrationsDir, `${migrationTag}__rebuild.json`);
}

export function writeRebuildMarker(
  migrationsDir: string,
  migrationTag: string,
  projections: readonly string[],
): void {
  // Leere Liste → kein File. Reduziert Noise bei Migrations die keine
  // Projection berühren (z.B. nur Infra-Tabellen oder pure Indizes).
  if (projections.length === 0) return;
  const marker: RebuildMarker = {
    schemaVersion: MARKER_VERSION,
    migrationTag,
    projections: [...projections].sort(),
  };
  writeFileSync(markerPath(migrationsDir, migrationTag), `${JSON.stringify(marker, null, 2)}\n`);
}

export function readRebuildMarker(
  migrationsDir: string,
  migrationTag: string,
): RebuildMarker | null {
  const path = markerPath(migrationsDir, migrationTag);
  if (!existsSync(path)) return null;
  const parsed = JSON.parse(readFileSync(path, "utf-8")) as RebuildMarker;
  if (parsed.schemaVersion !== MARKER_VERSION) {
    throw new Error(
      `readRebuildMarker: ${path} hat schemaVersion ${parsed.schemaVersion}, ` +
        `erwartet ${MARKER_VERSION}. Kumiko-Version-Mismatch?`,
    );
  }
  return parsed;
}
