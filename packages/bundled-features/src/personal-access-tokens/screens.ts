import {
  i18nKey,
  type ProjectionListScreenDefinition,
  type SecretMintScreenDefinition,
} from "@cosmicdrift/kumiko-framework/engine";
import { PAT_MINT_SCREEN_ID, PAT_SCREEN_ID, PatHandlers, PatQueries } from "./constants";
import type { PatScopeConfig } from "./scopes";

export const patListScreen: ProjectionListScreenDefinition = {
  id: PAT_SCREEN_ID,
  type: "projectionList",
  query: PatQueries.mine,
  defaultSort: { field: "createdAt", dir: "desc" },
  columns: [
    { field: "name", label: i18nKey("pat.list.col.name") },
    { field: "prefix", label: i18nKey("pat.list.col.prefix") },
    { field: "scopes", label: i18nKey("pat.list.col.scopes") },
    { field: "status", label: i18nKey("pat.list.col.status") },
    {
      field: "createdAt",
      label: i18nKey("pat.list.col.created"),
      renderer: { format: "timestamp" },
    },
    {
      field: "expiresAt",
      label: i18nKey("pat.list.col.expires"),
      renderer: { format: "timestamp" },
    },
  ],
  rowActions: [
    {
      kind: "writeHandler",
      id: "revoke",
      label: i18nKey("pat.list.revoke"),
      handler: PatHandlers.revoke,
      style: "danger",
      confirm: i18nKey("pat.list.revoke.confirm"),
      visible: { field: "status", ne: "revoked" },
    },
  ],
  toolbarActions: [
    {
      kind: "navigate",
      id: "create",
      label: i18nKey("pat.create.title"),
      screen: PAT_MINT_SCREEN_ID,
      style: "primary",
    },
  ],
  access: { openToAll: true },
};

// Grant-string vocabulary for a scope config's multiSelect field — a
// read-only domain offers only "<domain>:read", one with a non-empty
// `write` set additionally offers "<domain>:write" (matches expandScopes/
// parseGrant in scopes.ts).
export function patGrantOptions(scopes: PatScopeConfig): string[] {
  const out: string[] = [];
  for (const [domain, def] of Object.entries(scopes)) {
    out.push(`${domain}:read`);
    if (def.write && def.write.length > 0) out.push(`${domain}:write`);
  }
  return out;
}

export function createPatMintScreen(scopes: PatScopeConfig): SecretMintScreenDefinition {
  return {
    id: PAT_MINT_SCREEN_ID,
    type: "secretMint",
    handler: PatHandlers.create,
    fields: {
      name: { type: "text", required: true, maxLength: 120 },
      scopes: {
        type: "multiSelect",
        required: true,
        display: "checkboxes",
        options: patGrantOptions(scopes),
      },
      expiresInDays: { type: "number", integer: true, min: 1, max: 3650, default: 90 },
      currentPassword: { type: "text", required: true, format: "password", sensitive: true },
      mfaCode: { type: "text" },
    },
    layout: {
      sections: [
        { fields: ["name", "scopes", "expiresInDays"] },
        // Separate section: create.write requires password (+ MFA code, if
        // enrolled) even though the request is already session-authed.
        {
          title: i18nKey("pat.create.reauth"),
          fields: ["currentPassword", "mfaCode"],
        },
      ],
    },
    submitLabel: i18nKey("pat.create.submit"),
    reveal: {
      title: i18nKey("pat.created.title"),
      warning: i18nKey("pat.created.hint"),
      confirmLabel: i18nKey("pat.created.dismiss"),
      fields: [
        { field: "token", label: i18nKey("pat.created.token"), display: "code", copyable: true },
      ],
    },
    redirect: PAT_SCREEN_ID,
    cancelTarget: PAT_SCREEN_ID,
    access: { openToAll: true },
  };
}
