---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-dev-server": patch
"@cosmicdrift/kumiko-dispatcher-live": patch
"@cosmicdrift/kumiko-headless": patch
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-renderer-web": patch
---

fix(es-ops): path.resolve statt path.join für seedsDir → seed-files

Bun's `await import()` braucht absolute Pfade. Wenn der App-Author
`runProdApp({ seedsDir: "./seeds" })` setzt (relativ), würde
`path.join("./seeds", "foo.ts")` einen relativen Pfad liefern → Bun's
Import-Resolver such relativ zum `runner.ts`-Modul (nicht zum
`process.cwd()`) → `Cannot find module 'seeds/...' from '<runner-path>'`.

`path.resolve` löst gegen `process.cwd()` auf → absolute Pfade →
Import funktioniert. Aufgedeckt beim ersten Live-Boot der publicstatus-
Driver-Migration (Pod CrashLoopBackOff).
