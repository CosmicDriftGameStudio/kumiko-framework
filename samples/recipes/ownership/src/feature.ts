// Ownership Sample
//
// Concrete contract-entity showing the full ownership matrix:
//
//   Dimension      | Entity-level         | Field-level
//   -----------    | -------------------- | --------------------------------
//   Read           | list/detail filter   | propX stripped from response JSON
//   Write          | create/update/delete | individual fields rejected loud
//   Rule shape     | { Role: OwnershipRule }            (same on both dimensions)
//   Rule kinds     | "all" | from(ref, col?) | { where: (user, table) => SQL }
//
// The entity below is the "contract" example from the H.2 design
// discussion: propA is public, propB is Admin-only, propC requires a
// matching team claim. Integration tests prove each row/column path.
//
// Why fail-loud on write (not silent drop): Silent-drop makes bugs
// invisible at the reporting layer. "Save doesn't work" with no error
// becomes weeks of blame between frontend / API / infrastructure. A loud
// `field_ownership_denied` with the field name + role + userId in the
// details payload is a single log-line to a root cause.

import {
  createEntity,
  createTextField,
  defineEntityQueryHandler,
  defineEntityWriteHandler,
  defineFeature,
  from,
} from "@kumiko/framework/engine";

// The "teams" feature declares the teamId claim. Any other feature can
// reference it via the QN string "teams:teamId" in ownership rules — no
// cross-feature import needed. The boot-validator rejects a reference to a
// claim no feature declared.
export const teamsFeature = defineFeature("teams", (r) => {
  r.claimKey("teamId", { type: "string" });
});

// Contract entity demonstrating the full access matrix.
export const contractEntity = createEntity({
  table: "read_ownership_contracts",
  softDelete: true,
  fields: {
    // teamId is the ownership-scoping column. It's referenced by claim-rules
    // via the default column (rule's shortName = "teamId" matches).
    teamId: createTextField({ required: true }),
    // Optional — when set, only that user (via user:id rule) can access.
    assigneeId: createTextField(),

    // propA: public field. No access declared — every caller reads AND writes.
    propA: createTextField(),

    // propB: Admin-only. Non-admins don't see it in responses; attempts
    // to write it return access_denied (role gate in dispatcher).
    propB: createTextField({
      access: {
        read: { Admin: "all" },
        write: { Admin: "all" },
      },
    }),

    // propC: Admin + Matching-Team. Non-admins with the wrong team see no
    // propC in responses; writes to propC on a foreign team's row return
    // field_ownership_denied (executor ownership check).
    propC: createTextField({
      access: {
        read: { Admin: "all", TeamMember: from("claim:teams:teamId") },
        write: { Admin: "all", TeamMember: from("claim:teams:teamId") },
      },
    }),
  },

  // Entity-level access: controls list/detail/update/delete/restore of the
  // whole row. Admin sees everything; TeamMember scoped to their team;
  // assigned Driver sees rows assigned to them.
  access: {
    read: {
      Admin: "all",
      TeamMember: from("claim:teams:teamId"),
      Driver: from("user:id", "assigneeId"),
    },
    write: {
      Admin: "all",
      TeamMember: from("claim:teams:teamId"),
      Driver: from("user:id", "assigneeId"),
    },
  },
});

export const contractsFeature = defineFeature("contracts", (r) => {
  r.entity("contract", contractEntity);

  r.writeHandler(
    defineEntityWriteHandler("contract:create", contractEntity, {
      access: { roles: ["Admin", "TeamMember", "Driver"] },
    }),
  );
  r.writeHandler(
    defineEntityWriteHandler("contract:update", contractEntity, {
      access: { roles: ["Admin", "TeamMember", "Driver"] },
    }),
  );
  r.writeHandler(
    defineEntityWriteHandler("contract:delete", contractEntity, {
      access: { roles: ["Admin", "TeamMember", "Driver"] },
    }),
  );
  r.writeHandler(
    defineEntityWriteHandler("contract:restore", contractEntity, {
      access: { roles: ["Admin", "TeamMember", "Driver"] },
    }),
  );
  r.queryHandler(
    defineEntityQueryHandler("contract:list", contractEntity, {
      access: { roles: ["Admin", "TeamMember", "Driver"] },
    }),
  );
  r.queryHandler(
    defineEntityQueryHandler("contract:detail", contractEntity, {
      access: { roles: ["Admin", "TeamMember", "Driver"] },
    }),
  );
});
