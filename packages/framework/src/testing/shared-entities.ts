import { buildDrizzleTable } from "../db/table-builder";
import {
  createBooleanField,
  createEntity,
  createNumberField,
  createTextField,
} from "../engine/factories";

// --- Shared Entity Fixtures -------------------------------------------------
//
// Replaces inline `createEntity(...) + buildDrizzleTable(...)` boilerplate
// that appeared in 20+ integration tests. Pick the shape closest to what
// the test needs; if a feature needs extras (hooks, state-machine, fields),
// keep a local inline entity rather than bloating these shared ones.

// "Just a name" — minimal entity with `name: text`, softDelete on.
// Used by every pipeline test that only needs SOMETHING to write events
// against (event-dispatcher*, event-retention, event-dedup, …).
export const sharedWidgetEntity = createEntity({
  fields: { name: createTextField({ required: true }) },
  softDelete: true,
});
export const sharedWidgetTable = buildDrizzleTable("widget", sharedWidgetEntity);

// User with searchable name/email fields. Used by full-stack, cascade,
// and any test that exercises search-indexing or field-access on a
// realistic-looking user record.
export const sharedUserEntity = createEntity({
  fields: {
    email: createTextField({ required: true, format: "email", searchable: true }),
    firstName: createTextField({ searchable: true }),
    lastName: createTextField({ searchable: true }),
    isEnabled: createBooleanField({ default: true }),
  },
  softDelete: true,
  searchWeight: 10,
});
export const sharedUserTable = buildDrizzleTable("user", sharedUserEntity);

// Item with name + optional price. Used by error-contract, batch,
// projection-rebuild — tests that need "a thing you can CRUD".
export const sharedItemEntity = createEntity({
  fields: {
    name: createTextField({ required: true }),
    price: createNumberField(),
  },
  softDelete: true,
});
export const sharedItemTable = buildDrizzleTable("item", sharedItemEntity);
