---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-renderer": patch
---

Console-spy tests only count the messages of the code under test

<!-- kumiko-changes
feature: framework
type: fix
title: Console-spy tests only count the messages of the code under test
detail: Unit tests that asserted a silent console.warn/error ran in a process shared with other test files and picked up unrelated async warnings. They now filter the spied calls to the messages the tested code produces. No runtime change.
-->
