---
"@cosmicdrift/kumiko-types": patch
---

`secrets`: `SecretBrand` uses `Symbol.for("kumiko.secret")` instead of a per-copy `Symbol()`. Two resolved copies of the package branded with two different symbols, so `createSecret()` from one and `isSecret()` from the other disagreed — and `isSecret()` is the only check `assertNoSecretLeak` has, so the response-leak guard walked past the value and serialized the plaintext. Matches the `Symbol.for` treatment the schema symbols already use (#1632).
