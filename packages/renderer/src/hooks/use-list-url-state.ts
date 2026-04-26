// useListUrlState — bündelt sort/dir/page/q einer entityList in einen
// per-screen-id namespaced URL-State. Mit Screen-ID-Prefix damit zwei
// Listen auf derselben Route (z.B. Dashboard mit Orders + Incidents)
// nicht über dieselben Query-Keys streiten.
//
// Param-Schema pro Liste:
//   <screenId>.sort  — field name (string)
//   <screenId>.dir   — "asc" | "desc"
//   <screenId>.q     — search term (URL-encoded)
//   <screenId>.page  — 1-based page number (nur bei pagination="pages")
//
// Schreibt mit setSearchParams (replaceState — kein push), damit
// Sort/Filter-Toggles nicht die Browser-History fluten.

import { useCallback, useMemo } from "react";
import { useNav } from "../app/nav";

export type ListSortDir = "asc" | "desc";
export type ListSort = {
  readonly field: string;
  readonly dir: ListSortDir;
};

export type ListUrlState = {
  /** Aktive Sortierung (oder null = unsorted, Server liefert Default-Order). */
  readonly sort: ListSort | null;
  /** Search-Term (leer wenn nicht gesetzt). */
  readonly q: string;
  /** 1-basierte Page-Nummer. Bei pagination="infinite" oder false ist
   *  der Wert ignoriert; Caller liest ihn nur wenn relevant. */
  readonly page: number;
};

export type ListUrlStateApi = ListUrlState & {
  /** Setzt sort + dir atomar. null = unsorted (löscht beide Keys). */
  readonly setSort: (next: ListSort | null) => void;
  /** Setzt den Search-Term. Empty-String löscht den Key. Caller debounced
   *  selber (z.B. useDebouncedCallback in der Search-Input-Komponente). */
  readonly setQ: (next: string) => void;
  /** Setzt die Page. 1 oder kleiner löscht den Key (Default-Page). */
  readonly setPage: (next: number) => void;
};

// `.` als Trenner: lesbar (`?orders.sort=name`), kollidiert nicht mit
// üblichen Field-Namen (kebab- oder camelCase ohne Punkt). Boot-Validator
// pinnt screen.id ohne Punkt — siehe boot-validator entityList Section.
function key(screenId: string, suffix: string): string {
  return `${screenId}.${suffix}`;
}

function parseDir(value: string | undefined): ListSortDir | undefined {
  return value === "asc" || value === "desc" ? value : undefined;
}

function parsePage(value: string | undefined): number {
  if (value === undefined) return 1;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export function useListUrlState(screenId: string): ListUrlStateApi {
  const nav = useNav();
  const params = nav.searchParams;

  const sort = useMemo<ListSort | null>(() => {
    const field = params[key(screenId, "sort")];
    const dir = parseDir(params[key(screenId, "dir")]);
    if (field === undefined || field === "" || dir === undefined) return null;
    return { field, dir };
  }, [params, screenId]);

  const q = params[key(screenId, "q")] ?? "";
  const page = parsePage(params[key(screenId, "page")]);

  const setSort = useCallback(
    (next: ListSort | null) => {
      // Atomares Update: bei jedem Sort-Wechsel resetten wir auch die
      // Page (sonst wäre der User auf "Seite 5 von alter Sortierung"
      // hängen, was visuell verwirrend ist). Page-Reset gilt auch bei
      // null — gleiche Logik.
      nav.setSearchParams({
        [key(screenId, "sort")]: next === null ? null : next.field,
        [key(screenId, "dir")]: next === null ? null : next.dir,
        [key(screenId, "page")]: null,
      });
    },
    [nav, screenId],
  );

  const setQ = useCallback(
    (next: string) => {
      // Search-Change resettet Page (gleicher Grund wie Sort) UND
      // Sort? Nein — User kann mit aktivem Sort suchen wollen, das
      // soll die Sortierung nicht zerlegen. Nur Page wird gereset.
      nav.setSearchParams({
        [key(screenId, "q")]: next === "" ? null : next,
        [key(screenId, "page")]: null,
      });
    },
    [nav, screenId],
  );

  const setPage = useCallback(
    (next: number) => {
      nav.setSearchParams({
        [key(screenId, "page")]: next <= 1 ? null : String(next),
      });
    },
    [nav, screenId],
  );

  return { sort, q, page, setSort, setQ, setPage };
}
