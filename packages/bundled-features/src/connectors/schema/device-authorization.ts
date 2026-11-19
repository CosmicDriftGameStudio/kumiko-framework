import { deriveEntityTableMeta } from "@cosmicdrift/kumiko-framework/db";
import {
  access,
  createEntity,
  createNumberField,
  createSelectField,
  createTextField,
  createTimestampField,
} from "@cosmicdrift/kumiko-framework/engine";
import { DEVICE_AUTHORIZATION_STATUS } from "../constants.ts";

const privilegedWrite = { write: access.privileged } as const;

// Rows live in the system tenant: the device has no tenant until an admin confirms the code.
// Only hashes of both codes are kept. A row is deleted when its code is redeemed, otherwise swept when a new request starts after it expired.
export const deviceAuthorizationEntity = createEntity({
  name: "connector-device-authorization",
  table: "store_connector_device_authorizations",
  softDelete: false,
  fields: {
    deviceCodeHash: createTextField({
      required: true,
      maxLength: 64,
      access: privilegedWrite,
      personal: false,
      reason: "credential_hash_used_as_exact_lookup_key",
    }),
    userCodeHash: createTextField({
      required: true,
      maxLength: 64,
      access: privilegedWrite,
      personal: false,
      reason: "credential_hash_used_as_exact_lookup_key",
    }),
    status: createSelectField({
      options: [DEVICE_AUTHORIZATION_STATUS.pending, DEVICE_AUTHORIZATION_STATUS.approved],
      required: true,
      default: DEVICE_AUTHORIZATION_STATUS.pending,
      access: privilegedWrite,
    }),
    ownerTenantId: createTextField({
      maxLength: 36,
      access: privilegedWrite,
      personal: false,
      reason: "pseudonymous_fk",
    }),
    connectorId: createTextField({
      maxLength: 36,
      access: privilegedWrite,
      personal: false,
      reason: "technical_reference",
    }),
    approvedByUserId: createTextField({
      maxLength: 36,
      access: privilegedWrite,
      personal: false,
      reason: "pseudonymous_fk",
    }),
    checkedByUserId: createTextField({
      maxLength: 36,
      access: privilegedWrite,
      personal: false,
      reason: "pseudonymous_fk",
    }),
    checkedAt: createTimestampField({ access: privilegedWrite }),
    requestIp: createTextField({
      required: true,
      maxLength: 64,
      access: privilegedWrite,
      personal: false,
      reason:
        "network_prefix_of_a_short_lived_pairing_request_deleted_on_redeem_or_swept_after_expiry",
    }),
    intervalSeconds: createNumberField({ required: true, access: privilegedWrite }),
    lastPolledAt: createTimestampField({ access: privilegedWrite }),
    expiresAt: createTimestampField({ required: true, access: privilegedWrite }),
    createdAt: createTimestampField({ required: true, access: privilegedWrite }),
  },
  indexes: [
    { unique: true, columns: ["deviceCodeHash"], name: "store_connector_dev_auth_device_uniq" },
    { unique: true, columns: ["userCodeHash"], name: "store_connector_dev_auth_user_uniq" },
  ],
});

export const deviceAuthorizationTable = deriveEntityTableMeta(deviceAuthorizationEntity, {
  source: "unmanaged",
});
