#!/usr/bin/env bun
// @runtime tooling
// Regenerates docs/reference/guards.md from the guard sources; the guards-doc-drift check fails on a stale file.
import { join } from "node:path";
import { GUARDS_DOC_REL, writeGuardsDoc } from "@cosmicdrift/kumiko-guards";

writeGuardsDoc(join(import.meta.dir, ".."));
process.stdout.write(`Wrote ${GUARDS_DOC_REL}\n`);
