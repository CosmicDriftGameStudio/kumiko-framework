import { buildEntityTable } from "../db/table-builder";
import { fileRefEntity } from "./file-ref-entity";

// `file_refs` ist die read-table des `fileRef`-Entity. Aus der Entity-
// Definition gebaut (kein hand-gepflegtes pgTable mehr), damit die implizite
// Entity-Projektion (Rebuild) und der Live-Executor-Write spaltengleich auf
// dieselbe Tabelle schreiben — Single Source, keine Dual-Definition-Drift.
//
// `id` ist UUID und doppelt als Aggregate-Id des fileRef-Event-Streams:
// jeder Upload appended `fileRef.created`, jeder Delete `fileRef.deleted`
// (Standard-Entity-Auto-Verben). UUIDs schließen die Enumeration-Attacke
// auf /files/:id.
export const fileRefsTable = buildEntityTable("fileRef", fileRefEntity);
