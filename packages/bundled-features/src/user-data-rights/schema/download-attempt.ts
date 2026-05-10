import { buildDrizzleTable } from "@cosmicdrift/kumiko-framework/db";
import {
  createEntity,
  createTextField,
  createTimestampField,
} from "@cosmicdrift/kumiko-framework/engine";

// Audit-Trail invalid Download-Attempts (S2.U7).
// Schreibt eine Row pro 4xx im download-by-{token,job}-Pfad. DPO erkennt
// damit Brute-Force / Anomalien (gleiche IP, viele invalid-Versuche).
// Success-Downloads landen in download-token.lastUsedAt — nicht hier.
export const downloadAttemptEntity = createEntity({
  table: "read_download_attempts",
  idType: "uuid",
  fields: {
    // notFound | expired | failed | signedUrlNotSupported
    result: createTextField({ required: true, maxLength: 32 }),
    // Welcher Pfad: "token" | "job"
    via: createTextField({ required: true, maxLength: 16 }),
    // Token-Hash (token-Pfad) oder NULL (job-Pfad / unbekannter Token).
    tokenHash: createTextField({ maxLength: 64 }),
    // Job-ID wenn der attempt einen kannte. NULL bei unbekanntem Token.
    jobId: createTextField({}),
    // User-ID wenn auth-Pfad (job). NULL bei anonymous (token-Pfad).
    attemptedByUserId: createTextField({}),
    ip: createTextField({ maxLength: 64 }),
    userAgent: createTextField({ maxLength: 256 }),
    attemptedAt: createTimestampField({ required: true }),
  },
  // 90d hardDelete: unbounded growth = disk-bomb genau gegen das System
  // das den Brute-Force erkennen soll. Brute-Force-Patterns sind kurzfristig
  // (Stunden bis Tage) — 90d Window deckt forensik-Reviews + DPO-quartal-
  // Audits. Tenant kann via override verlängern (HR-Compliance).
  retention: { keepFor: "90d", strategy: "hardDelete", reference: "attemptedAt" },
});

export const downloadAttemptsTable = buildDrizzleTable("downloadAttempt", downloadAttemptEntity);
