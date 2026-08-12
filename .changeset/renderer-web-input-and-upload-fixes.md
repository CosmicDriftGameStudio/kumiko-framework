---
"@cosmicdrift/kumiko-renderer-web": patch
---

Several input/widget bug fixes:

- `MoneyInput` selects the input text on focus via `useLayoutEffect` instead of `useEffect` — fixes a race where a fast click-then-type could land the cursor mid-value instead of selecting it first.
- `EmbeddedListInput` totals now format with the resolved UI locale (`useLocale()`) instead of always the default locale.
- `UploadZone` now filters dropped files through `accept` the same way the file-picker dialog already did — a drag&drop drop previously bypassed the filter entirely and any file type reached `onUpload`. A non-`Error` upload failure now shows a translated fallback message instead of the raw internal token; new `kumiko.widget.upload.error`/`kumiko.widget.upload.rejected-type` i18n keys.
- `AiTextField` now propagates `hideLabel` to its underlying `Field`, matching the other form widgets.
- `ProgressBar` clamps a `NaN` `value` (e.g. `done / total` with `total: 0`) to 0 instead of rendering `width: "NaN%"` and an invalid `aria-valuenow`.
- `InfinityList` dedupes appended rows against already-loaded ones — a live-merge that re-sorts a row to the front of page 1 could otherwise have an offset-based cursor re-serve that same row on a later page, landing it twice under duplicate React keys.
- `Drawer`'s initial width now clamps `resize.defaultWidthPx` on the very first render instead of only once the user starts dragging (fw#1965).
