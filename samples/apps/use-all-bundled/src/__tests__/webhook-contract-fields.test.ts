// Derived entity webhook contracts leave the system. This pins the releasable field names per
// bundled entity so a new credential/internal field cannot slip into webhooks unnoticed:
// a change here must be a conscious review decision.

import { describe, expect, test } from "bun:test";
import { apiTokenEntity } from "@cosmicdrift/kumiko-bundled-features/personal-access-tokens";
import {
  createWebhookContractResolver,
  defineFeature,
  type FeatureDefinition,
} from "@cosmicdrift/kumiko-framework/engine";
import config from "../../kumiko.config";

const RELEASABLE_FIELDS: Readonly<Record<string, string>> = {
  "config/config-value": "id key value userId",
  "user/user": "id locale timezone emailVerified roles status gracePeriodEnd",
  "tenant/tenant":
    "id key isEnabled status destroyRequestedAt destroyRequestedBy gracePeriodEnd destroyStartedAt destroyedAt",
  "tenant/tenant-membership": "id userId roles",
  "tenant/tenant-invitation": "id role globalRoles status membershipVersion expiresAt",
  "secrets/tenant-secret": "id key kekVersion",
  "auth-mfa/user-mfa": "id userId enabledAt lastUsedAt",
  "readiness/probe-run":
    "id status includePaid includeSystemProbes triggeredByUserId requestedAt startedAt finishedAt durationMs okCount failedCount skippedCount results",
  "delivery/notification-preference": "id userId notificationType channel enabled",
  "delivery/notification-address-opt-out": "id notificationType channel",
  "files/fileRef": "id mimeType size entityType entityId fieldName",
  "tier-engine/tier-assignment": "id tier source",
  "cap-counter/cap-counter": "id capName value periodStart lastSoftWarnedAt",
  "compliance-profiles/tenant-compliance-profile": "id profileKey override",
  "data-retention/tenant-retention-override": "id entityName config reason",
  "user-data-rights/export-job":
    "id userId requestedFromTenantId status requestedAt startedAt completedAt expiresAt errorMessage bytesWritten",
  "user-data-rights/export-download-token": "id jobId issuedAt expiresAt lastUsedAt useCount",
  "user-data-rights/download-attempt": "id result via jobId attemptedByUserId attemptedAt",
  "waitlist/waitlistEntry":
    "id company portfolio locale status submittedAt invitedAt invitedBy provisionedAt linkedTenantId",
  "helpdesk/helpdesk-request":
    "id kind status source reporterUserId reporterTenantId reporterTenantName reporterTenantPlan page appVersion browser locale fileCount submittedAt answeredAt closedAt replyCount",
  "helpdesk/helpdesk-reply":
    "id requestId reporterUserId authorUserId authorName fileIds channels sentAt",
  "template-resolver/template-resource":
    "id slug kind locale title folder content contentFormat variableSchema linkedResources meta scope parentTemplateId status draft activeVersion activeSince",
  "template-resolver/user-content-entry": "id ownerId slug kind locale title folder contentFormat",
  "renderer-puppeteer-client/rendered-pdf":
    "id fileRefId templateSlug locale templateId templateVersion templateScope layoutId layoutVersion pageCount",
  "managed-pages/page": "id slug lang title body bodyFormat description ogImage published",
  "custom-fields/field-definition":
    "id entityName fieldKey type required searchable displayOrder serializedField",
  "tags/tag": "id name color scope",
  "tags/tag-assignment": "id tagId entityType entityId",
  "notes-history/note-entry": "id entityType entityId authorId",
  "notes-history/note-mention": "id noteId subjectId",
  "form-draft/form-draft": "id ownerId draftKey",
  "folders/folder": "id name parentId",
  "folders/folder-assignment": "id folderId entityType entityId",
  "documents/filed-document": "id title category issuedAt validUntil file",
  "documents/filed-document-link": "id documentId entityType entityId",
  "ledger/account": "id name type code parentId",
  "ledger/transaction": "id date description reference status lines subjectType subjectId",
  "ledger/schedule":
    "id description startDate endDate interval amount debitAccountId creditAccountId subjectType subjectId sourceRef",
  "document-ingest-foundation/documentExtract": "id fileRefId pages meta",
  "notes-demo/note": "id title customFields",
};

const NEVER_RELEASED = ["passwordHash", "tokenHash", "storageKey", "downloadStorageKey"];

function releasedFields(resolver: ReturnType<typeof createWebhookContractResolver>, name: string) {
  const contract = resolver.get(`${name}.created`);
  return contract ? Object.keys(contract.payload.shape) : undefined;
}

// No bundle entity opts in, so the field filter is exercised with the flag set on every entity.
const featuresWithOptIn: readonly FeatureDefinition[] = config.features.map((feature) => ({
  ...feature,
  entities: Object.fromEntries(
    Object.entries(feature.entities ?? {}).map(([name, entity]) => [
      name,
      { ...entity, webhookEvents: true },
    ]),
  ),
}));

describe("derived entity webhook contracts", () => {
  const resolver = createWebhookContractResolver(featuresWithOptIn);

  test("no bundled entity releases entity events without the opt-in", () => {
    const withoutOptIn = createWebhookContractResolver(config.features);
    for (const feature of config.features) {
      for (const [name, entity] of Object.entries(feature.entities ?? {})) {
        expect(entity.webhookEvents).toBeUndefined();
        for (const verb of ["created", "updated", "deleted"]) {
          expect(withoutOptIn.get(`${name}.${verb}`)).toBeUndefined();
        }
      }
    }
  });

  test("releasable field names per bundled entity are pinned", () => {
    const actual: Record<string, string> = {};
    for (const feature of featuresWithOptIn) {
      for (const name of Object.keys(feature.entities ?? {})) {
        const fields = releasedFields(resolver, name);
        if (fields) actual[`${feature.name}/${name}`] = fields.join(" ");
      }
    }
    expect(actual).toEqual(RELEASABLE_FIELDS);
  });

  test("credential fields are never released", () => {
    for (const feature of featuresWithOptIn) {
      for (const name of Object.keys(feature.entities ?? {})) {
        const fields = releasedFields(resolver, name) ?? [];
        for (const forbidden of NEVER_RELEASED) expect(fields).not.toContain(forbidden);
      }
    }
  });

  test("the real api-token entity would not release tokenHash", () => {
    const feature = defineFeature("pat-probe", (r) => {
      r.entity({ name: "api-token", ...apiTokenEntity, webhookEvents: true });
    });
    const fields = releasedFields(createWebhookContractResolver([feature]), "api-token");
    expect(fields).toBeDefined();
    expect(fields).not.toContain("tokenHash");
  });
});
