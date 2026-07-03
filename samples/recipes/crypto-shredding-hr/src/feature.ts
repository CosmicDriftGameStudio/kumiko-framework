// Crypto-Shredding Sample — Mini-HR
// Shows: PII annotations that make GDPR forget a key-erase instead of a
// data-hunt. Fields marked `pii: true` are encrypted under the subject key
// of their OWN row (the employee); fields marked `userOwned: { ownerField }`
// are encrypted under the key of the user the row is ABOUT — so a manager's
// comment on an employee dies with the employee's key, not the manager's.
//
// Requirements: a KMS adapter must be configured (`runProdApp({ kms })` in
// production, `configurePiiSubjectKms(new InMemoryKmsAdapter())` in tests).
// Without one, fields are stored in plaintext and a boot warning is logged.
//
// Forget = `kms.eraseKey(subject)` — the ciphertext stays in rows and
// events, but is unreadable forever; reads render the `[[erased]]` sentinel.
// The `crypto-shredding` bundled feature ships the operator command for
// this; `user-data-rights` erases user keys automatically after the
// deletion grace period.

import {
  createEntity,
  createTextField,
  defineEntityCreateHandler,
  defineEntityDetailHandler,
  defineEntityListHandler,
  defineFeature,
} from "@cosmicdrift/kumiko-framework/engine";

export const employeeEntity = createEntity({
  table: "read_hr_employees",
  fields: {
    // pii: true → encrypted under this row's own subject key (user:<row.id>).
    displayName: createTextField({ required: true, pii: true }),
    email: createTextField({ required: true, format: "email", pii: true }),
    // Not personal data — stays plaintext, searchable, sortable.
    department: createTextField({ sortable: true }),
  },
  softDelete: true,
});

export const hrCommentEntity = createEntity({
  table: "read_hr_comments",
  fields: {
    employeeId: createTextField({ required: true }),
    // userOwned → encrypted under the EMPLOYEE's key (the subject of the
    // comment), not the author's. Erasing the employee's key makes every
    // comment about them unreadable — no per-row cleanup hunt.
    body: createTextField({ required: true, userOwned: { ownerField: "employeeId" } }),
    authorName: createTextField(),
  },
  softDelete: true,
});

const hrWrite = { access: { roles: ["Admin"] } } as const;
const hrRead = { access: { roles: ["Admin"] } } as const;

export const hrFeature = defineFeature("hr", (r) => {
  r.entity("employee", employeeEntity);
  r.entity("hr-comment", hrCommentEntity);

  r.writeHandler(defineEntityCreateHandler("employee", employeeEntity, hrWrite));
  r.queryHandler(defineEntityDetailHandler("employee", employeeEntity, hrRead));
  r.queryHandler(defineEntityListHandler("employee", employeeEntity, hrRead));

  r.writeHandler(defineEntityCreateHandler("hr-comment", hrCommentEntity, hrWrite));
  r.queryHandler(defineEntityDetailHandler("hr-comment", hrCommentEntity, hrRead));
});
