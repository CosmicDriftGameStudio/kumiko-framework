// CI-only preload (bunfig.ci.toml). Logs the active test profile so CI logs
// show which concurrency/config is in effect — no guessing from wall-clock alone.

console.log(
  "[kumiko-test] CI profile active — config=bunfig.ci.toml concurrency=1",
);
