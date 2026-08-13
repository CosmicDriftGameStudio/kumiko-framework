---
"@cosmicdrift/kumiko-headless": patch
"@cosmicdrift/kumiko-renderer": patch
---

Fixes a crash: `useForm()` (used by `RenderEdit` and every other form consumer) called `useDispatcher()` unconditionally on every mount, throwing if no `<DispatcherProvider>` was mounted above it — even for forms that never write, or that pass an explicit `submit.dispatcher`. It now uses the optional variant; `SubmitConfig.dispatcher` is optional and `submit()` throws only when it's actually about to dispatch a write with no dispatcher available.
