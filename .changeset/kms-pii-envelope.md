---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-dev-server": minor
---

Crypto-shredding phase C — event-store PII envelope engine (#724): fields annotated `pii` / `userOwned` / `tenantOwned` are encrypted with the erase subject's DEK at the same executor hook points as `encrypted: true`. Storage format `kumiko-pii:v1:<subjectKey>:<base64(iv|tag|ct)>` names the subject inline; event payload AND projection row carry ciphertext (live == rebuild by construction), legacy plaintext passes through on read. Subject keys are created on first write; reads after `eraseKey` render the `[[erased]]` sentinel; writes to an erased subject fail. `runProdApp({ kms })` wires the engine — without an adapter it stays off (plaintext, pre-phase-C behavior) and boot warns; the hard gate ships with the prod-grade PgKmsAdapter (phase E). Also: `forget()` now re-encrypts `previous` like `delete()` (plaintext of encrypted/pii fields no longer lands in the forgotten event), `userOwned.ownerField` accepts text fields (ES userId-by-convention), and `user-session.ip/userAgent` + `tenant-invitation.invitedBy` annotations now name the referenced user as their subject.
