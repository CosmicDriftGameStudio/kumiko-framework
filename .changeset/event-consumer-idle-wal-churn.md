---
"@cosmicdrift/kumiko-framework": patch
---

Event-Consumer-Dispatcher schreibt keinen Cursor-Heartbeat mehr wenn ein Poll-Tick
keine neuen Events findet — verhindert unbegrenztes WAL-Wachstum bei idle Consumern.
