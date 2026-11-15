---
"@cosmicdrift/kumiko-bundled-features": patch
---

The helpdesk tests pick a nonce that verifiably fails the proof of work instead of guessing one.

<!-- kumiko-changes
feature: helpdesk
type: fix
title: helpdesk tests no longer flake on a guessed wrong nonce
detail: A guessed wrong nonce still solved the challenge with probability 2^-bits at the low test difficulty, so the dropped-submit and wrong-nonce tests failed now and then. The tests now search for a nonce that fails verification. No runtime change.
-->
