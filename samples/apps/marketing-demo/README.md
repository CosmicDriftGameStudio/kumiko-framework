# Marketing Demo

Sample app that produces marketing screenshots for
[kumiko.so](https://kumiko.so). Two small internal tools (asset tracker
+ helpdesk) on a single Kumiko instance — a DACH-persona proof that the
same framework stack covers two tools without separate codebases.

**No auth** — like the showcase, in auto-mint-JWT mode. Straight to
the edit/list screen without a login. To exercise auth paths, see
`samples/apps/ui-walkthrough/`.

## Run

```bash
yarn kumiko dev                          # Postgres + Redis
cd samples/apps/marketing-demo && yarn dev
# → http://localhost:4178
```

Port 4178 is hardcoded so the sample apps can run in parallel
(showcase=4175, ui-walkthrough=4173, workspaces=4174,
publicstatus=4176/77).

## What's inside

### Asset tracker (12 fields)

- `name`, `type` (laptop/monitor/phone/tool/license/other), `status`
  (available/lent/maintenance/broken), `department`, `owner`,
  `location`, `serialNumber`, `vendor`, `price`, `purchaseDate`,
  `warrantyUntil`, `notes` (multiline)
- Edit form: 3 sections (Master data / Assignment / Purchase)
- List: 9-column DataTable with translated status cells
- ~70 items in the seed (35 templates × 1-3 copies, deterministic)

### Helpdesk (10 fields)

- `title`, `description` (multiline), `category` (hardware/software/
  account/network/license/other), `severity`, `status` (open/
  investigating/resolved/closed), `department`, `reporter`, `assignee`,
  `dueDate`, `spentMinutes`
- Edit form: 3 sections (Ticket / People / Tracking)
- List with severity default sort
- 35 tickets with German titles

## i18n

All field labels + select options have DE+EN translations
(`<feature>:entity:<entity>:field:<field>`,
`<feature>:entity:<entity>:field:<field>:option:<value>`). List cells
and form selects pull the translation from the ViewModel builder — so
`hr` renders as "HR" / "Personal", `lent` as "Lent out" /
"Ausgeliehen" instead of raw values.

## Schema pattern

Both schemas use `createEntity()` + field factories
(`createTextField`, `createSelectField`, `createDateField`,
`createNumberField`) instead of an inline-object cast. The select
options are exported as `as const` constants (`ASSET_STATUSES`,
`TICKET_SEVERITIES`, …) — the seed derives its template types from
them, no drift when options change.

## Screenshots

```bash
yarn screenshots                         # Playwright E2E on 4179
```

Writes 4 PNGs to
`../../../kumiko-platform/apps/marketing/public/screenshots/`:

- `asset-list.png` — DataTable with translated cells
- `asset-edit.png` — 3-section edit form
- `ticket-list.png` — Helpdesk with severity default sort
- `ticket-edit.png` — Ticket form

Override via the `SCREENSHOT_DIR` env if the repos don't both live
under `/Users/marc/code/`. Not run by CI — manual regeneration after
schema or branding changes.

Setup details in `e2e/screenshots.spec.ts` + `e2e/scenarios.ts`.

## What's NOT in here

- Auth (see `apps/ui-walkthrough/`)
- Workspaces (see `apps/workspaces/`)
- Custom workflows / lifecycle hooks (see `recipes/`)
- Domain-specific features — this is explicitly a marketing showcase,
  not a business sample.
