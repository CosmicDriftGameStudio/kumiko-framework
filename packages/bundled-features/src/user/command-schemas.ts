// Command-input schemas for the user write handlers, re-exposed for external
// consumers — primarily migration mappers that need to write events directly
// into the core `user` stream via `eventStore.appendRaw` (Marten-bypass) and
// must validate their payloads against the exact handler contract.
//
// See `tenant/command-schemas.ts` for the same pattern + the schema-vs-event-
// payload caveat (strip-id, defaults, sensitive, compound-type flattening).

import { createWrite } from "./handlers/create.write";
import { updateWrite } from "./handlers/update.write";

export const UserCommandSchemas = {
  create: createWrite.schema,
  update: updateWrite.schema,
} as const;
