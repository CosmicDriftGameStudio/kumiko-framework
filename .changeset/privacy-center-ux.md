---
"@cosmicdrift/kumiko-bundled-features": minor
---

privacy-center UX polish:
- Removed the activity-log (Art. 15) section — it showed raw event-type names with no useful detail; the data export already covers Art. 15.
- Sections now use the `<Section>` primitive (consistent card optic + shadow) instead of hand-rolled card divs.
- Export section auto-polls the status while a job is pending/running, so the download link appears without a manual reload.
- New `userDataRightsClient({ privacyCenter: { showDeletion: false } })` option hides the deletion section — for apps that already offer account deletion elsewhere (e.g. a profile danger zone), to avoid duplication.
