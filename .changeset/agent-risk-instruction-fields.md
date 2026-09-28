---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-types": minor
---

Agent-risk floor for writes on fields read as instructions

<!-- kumiko-changes
feature: framework
type: breaking
title: Writes on readAsInstruction fields now require agent.risk "high" on the directly-dispatched handler
migration: |
  New field flag `readAsInstruction: true` on `text`, `longText`, and `jsonb`
  fields (`@cosmicdrift/kumiko-types`) marks a field whose value a later run
  reads as an instruction — a prompt, rule, or template. Any create/update
  whose payload writes such a field must resolve `agent.risk: "high"` on the
  directly-dispatched entry handler, or the executor gate denies it with
  `access_denied` / `instruction_field_write_requires_high_risk` before any
  DB write. This is opt-in per field, but touches every write path once a
  field carries the flag — consumer checklist:

  1. Mark fields that a later run reads as an instruction (prompts, rules,
     templates) with `readAsInstruction: true`.
  2. Update your own handlers that write such a field via
     `executor.create`/`executor.update`, or delegate into one via
     `ctx.write`/`writeAs`, to `agent: { risk: "high" }` — the directly
     called handler must carry it, delegation does not inherit it.
  3. Standard entity-convention create/update handlers on an entity with such
     a field now default to "high" automatically; declaring a lower
     `agent.risk` on one is a define-time error, same as the delete floor
     from #3345.
  4. An update whose payload doesn't include the flagged field stays allowed
     unchanged — the gate checks payload presence after `preSave`, not
     whether the value actually changed.
  5. Not gated: `delete`/`restore` (they don't write the field; the existing
     irreversible-delete floor still applies), and your own domain events
     applied via `ctx.appendEvent` whose projection writes a flagged field —
     route such writes through the executor primitives (`create`/`update`)
     to get the gate.
-->
