import { deriveEntityTableMeta } from "@cosmicdrift/kumiko-framework/db";
import {
  access,
  createEntity,
  createTextField,
  createTimestampField,
} from "@cosmicdrift/kumiko-framework/engine";

const privilegedWrite = { write: access.privileged } as const;

// One row per paired device, in the system tenant because the request carries only the secret and
// the tenant is found through this row. `tokenHash` is the SHA-256 of the `ksat_` secret; the
// plaintext exists once, in the token response.
export const deviceEntity = createEntity({
  name: "connector-device",
  table: "store_connector_devices",
  softDelete: false,
  fields: {
    ownerTenantId: createTextField({
      required: true,
      maxLength: 36,
      access: privilegedWrite,
      personal: false,
      reason: "pseudonymous_fk",
    }),
    connectorId: createTextField({
      required: true,
      maxLength: 36,
      access: privilegedWrite,
      personal: false,
      reason: "technical_reference",
    }),
    tokenHash: createTextField({
      required: true,
      maxLength: 64,
      access: privilegedWrite,
      personal: false,
      reason: "credential_hash_used_as_exact_lookup_key",
    }),
    tokenPrefix: createTextField({
      required: true,
      maxLength: 16,
      access: privilegedWrite,
      personal: false,
      reason: "credential_prefix_read_without_decrypt",
    }),
    reportedVersion: createTextField({
      maxLength: 64,
      access: privilegedWrite,
      personal: false,
      reason: "software_version_of_the_device",
    }),
    lastSeenAt: createTimestampField({ access: privilegedWrite }),
    createdAt: createTimestampField({ required: true, access: privilegedWrite }),
    revokedAt: createTimestampField({ access: privilegedWrite }),
  },
  indexes: [
    { unique: true, columns: ["tokenHash"], name: "store_connector_devices_hash_uniq" },
    { columns: ["ownerTenantId", "connectorId"], name: "store_connector_devices_owner_idx" },
  ],
});

export const deviceTable = deriveEntityTableMeta(deviceEntity, { source: "unmanaged" });
