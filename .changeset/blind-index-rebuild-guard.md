---
"@cosmicdrift/kumiko-framework": minor
---

Blind-index apply/rebuild fails loud on unkeyed PII ciphertext instead of silently writing NULL (fw#3091)

The `<field>_bidx` column is schema-driven (present on every install, encrypted or not), so `computeBlindIndexValues` returning `{}` when no blind-index key is configured is correct for a plaintext install — the column stays NULL, unchanged since before kumiko-framework#818. It was wrong for an encrypted install missing only the blind-index key: the same silent `{}` wrote NULL into the bidx column for an actually-encrypted row instead of failing. `computeBlindIndexValues` now inspects the lookupable field values when no key is configured, and throws if any of them is PII ciphertext — erased-sentinel and non-string values are exempt, so a legitimately forgotten subject never blocks a rebuild. `blindIndexForValue` already throws for the complementary case (key present, PII-subject KMS missing).

<!-- kumiko-changes
feature: framework
type: breaking
title: Blind-index apply/rebuild fails loud on unkeyed PII ciphertext instead of silently writing NULL (fw#3091)
-->
