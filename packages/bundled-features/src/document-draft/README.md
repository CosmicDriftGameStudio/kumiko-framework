# document-draft

One editable copy of a PDF document template per object (for example a lease contract). A draft is
created from a template, or from one of its variants, with the values of its placeholders. It is
changed with the same structured operations as `template-resolver:write:patch-draft` (or with the HTML
of an editor) and finalized to a stored PDF. The template stays unchanged.

## Setup

```typescript
import { createDocumentDraftFeature } from "@cosmicdrift/kumiko-bundled-features/document-draft";

createDocumentDraftFeature({
  subjectTypes: ["lease"],
});
```

The feature prints through the print client directly; mount `renderer-puppeteer-client` (it is a required feature). Requires the
`files`, `template-resolver` and `user-data-rights` features.

## Options

| Option           | Default                                      | Effect                                                                                                                       |
| ---------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `subjectTypes`   | required                                     | Entity names a draft belongs to; `create` refuses any other (400), a subject row the user cannot read answers 404 everywhere |
| `retention`      | `{ keepFor: "10y" }`                         | How long drafts are kept, counted from creation, hard delete                                                                 |
| `access`         | `{ roles: ["TenantAdmin", "TenantMember"] }` | `AccessRule` of all handlers and queries                                                                                     |
| `subjectScreens` | none                                         | Screen id per subject type that the editor returns to after finalize or discard, opened with the subject id                  |

## Handlers and queries

| Name               | What it does                                                                                                                                                                        |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `write:create`     | `{subjectType, subjectId, templateSlug, variant?, locale?, variables}`: copies the template text with its placeholders, freezes `variables` with the draft; returns `{id, version}` |
| `write:patch`      | `{id, base, ops}`: structured ops on an open draft; `setVariable`, `setMeta`, `setResource` fail with `op_not_allowed`                                                              |
| `write:save`       | `{id, base, content}`: replaces the text with sanitized editor HTML                                                                                                                 |
| `write:finalize`   | `{id, base}`: prints the draft body with the frozen variables, stores the PDF; status `finalized`, `fileRefId` set                                                                  |
| `write:revise`     | `{id, base}`: reopens a finalized draft, `revision` + 1, file reference cleared                                                                                                     |
| `write:discard`    | `{id, base}`: discards an open draft                                                                                                                                                |
| `query:blocks`     | `{id}`: the draft with block ids, deviations from the template, the variable schema, `subjectScreen` and `version` (the `base` of the next write)                                   |
| `query:by-subject` | `{subjectType, subjectId}`: the non-discarded drafts of one object, newest first                                                                                                    |

`base` is the draft's `version`; a stale one fails with `version_conflict`. `patch`, `save`, `finalize`
and `discard` need status `open`, `revise` needs `finalized` (422 `document_draft_not_open`,
`document_draft_not_finalized`). A variant must belong to `templateSlug`, otherwise
`template_variant_unknown`; a missing template fails with `template_not_found`.

The placeholders stay in the body; the variables are applied when the PDF is printed, so a draft
shows `{{...}}` in the editor and every `finalize` prints the current values.

## Editor screen

The browser entry `@cosmicdrift/kumiko-bundled-features/document-draft/web` has `documentDraftClient()`
for `createKumikoApp({ clientFeatures })`. It mounts the custom screen `document-draft:screen:document-draft-editor`
(`DOCUMENT_DRAFT_EDITOR_SCREEN_ID`, short id `document-draft-editor`), which the app opens with the draft id as
entity id. The screen is dormant: the app decides where it is reachable.

The editor shows the draft text with its placeholders (labelled with the frozen values), a preview, the
template (its title, or the slug and variant when it has none), the revision, the status and the deviations from the template. An open draft can be saved,
finalized (only without unsaved changes) or discarded; a finalized one is read-only with its file name and
"Edit again" (`revise`). After finalize or discard the screen opens `subjectScreens[subjectType]` with the
subject id; without one it stays and shows the new state. Saving re-serializes the whole text through the editor, so
blocks the editor normalizes (for example tables with repeat rows) can show as deviations although the
user did not touch them.

## Personal data

Body, variables, file name and the last change (which holds the ops) are personal data of the draft
itself: the draft row is its own crypto-shredding subject, like a signer. With a mounted subject KMS
the events hold them as ciphertext. The user forget run does not reach them. When the object a draft
belongs to is erased, call `forgetDocumentDraftsOfSubject(ctx, { subjectType, subjectId })`: it
purges the draft rows and erases their keys, so the old events stay unreadable. Without a KMS the
key erase does nothing and the old events keep plaintext.

The subject check runs in `beforeTransaction` of `finalize` too, so a caller who may not read the subject gets 404 before anything is printed.
