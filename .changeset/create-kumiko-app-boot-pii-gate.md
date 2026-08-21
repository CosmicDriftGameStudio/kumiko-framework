---
"@cosmicdrift/kumiko-dev-server": patch
---

`bun create kumiko-app --yes` now wires the generated `bin/main.ts`'s `runProdApp` call through `resolveKmsWiring` (existing framework helper), so the default `--yes` feature set no longer hits `BOOT ABORTED` on the first `bun run boot` / `bun run start`. Without a configured subject-keys KMS this falls back to plaintext PII with a loud boot warning — never silently — and the generated `.env.example`/README now document the `PLATFORM_KEK` / `SUBJECT_KEYS_DATABASE_URL` / `KUMIKO_BLIND_INDEX_KEY` trio needed for a real deploy.
