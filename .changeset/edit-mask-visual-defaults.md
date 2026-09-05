---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-renderer-web": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-headless": minor
---

Edit masks and screen actions now carry visual defaults instead of stacking identical text buttons.

- `RowAction` accepts an `icon` key, and `entityEdit` screens accept `actions` at all — an edit mask is no longer limited to Cancel and Save. Actions without a declared icon derive one from their id, so existing screens gain icons without a schema change.
- More than two icon-bearing actions collapse to icon-only buttons; the delete action moves to the far left of the form footer.
- Boolean fields render as a switch with the label above; select fields with at most four options render as a segmented group at content width instead of a full-width dropdown.
- Text fields derive a prefix icon from their name (email, phone, url, city, …).
- The form card gets a tinted, divided header band matching its footer, and metric cells render as dividers rather than nested cards.
