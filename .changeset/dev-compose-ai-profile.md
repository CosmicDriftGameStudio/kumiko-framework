---
---

Add an opt-in `ai` Docker Compose profile to the dev stack — `ollama` (LLM, OpenAI-compatible at :11434) + `faster-whisper-server` (STT, OpenAI-compatible at :9000) — so developers share one local AI backend instead of standalone Ollama/Whisper installs. An `ollama-init` sidecar auto-pulls a default model (`qwen2.5:7b`, override via `KUMIKO_OLLAMA_MODEL`) so the LLM works out of the box. Dev-only and profile-gated: a plain `docker compose up` (Postgres/Redis/Meili/MinIO for integration tests) is unaffected.
