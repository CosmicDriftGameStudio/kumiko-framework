// Globaler Vitest-Setup: Temporal-Polyfill bevor irgendein Test-Code läuft.
//
// Jeder Test der `ctx.tz` (oder direkt `Temporal.*`) verwendet braucht den
// Polyfill — ohne wäre globalThis.Temporal undefined und Test-Code würde
// mit "Temporal not available" werfen.
//
// In den Production-Boot-Pfaden (setupTestStack, server-bootstrap) wird der
// Polyfill explizit per ensureTemporalPolyfill() installiert. Für reine Unit-
// Tests (die nicht durch setupTestStack laufen) brauchen wir diesen
// Bootstrap-File.

import { ensureTemporalPolyfill } from "./packages/framework/src/time/polyfill";

await ensureTemporalPolyfill();
