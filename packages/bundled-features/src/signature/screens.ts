import {
  type EntityListScreenDefinition,
  i18nKey,
  type ProjectionDetailScreenDefinition,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  SIGNATURE_REQUEST_ENTITY,
  SIGNATURE_REQUEST_STATUS,
  SIGNATURE_SIGNER_ENTITY,
  SIGNATURE_SIGNER_STATUS,
  SignatureHandlers,
  SignatureQueries,
} from "./web/constants.ts";

const REQUEST = `signature:entity:${SIGNATURE_REQUEST_ENTITY}:field`;

const UNSIGNED_SIGNER = {
  field: "status",
  in: [SIGNATURE_SIGNER_STATUS.Pending, SIGNATURE_SIGNER_STATUS.Viewed],
} as const;

const CANCEL_ACTION = {
  id: "cancel",
  label: i18nKey("signature.action.cancel"),
  handler: SignatureHandlers.cancel,
  payload: { map: { requestId: "id" } },
  confirm: i18nKey("signature.action.cancel.confirm"),
  style: "danger",
  visible: { field: "status", eq: SIGNATURE_REQUEST_STATUS.Open },
} as const;

export function createSignatureListScreen(
  access: EntityListScreenDefinition["access"],
): EntityListScreenDefinition {
  return {
    id: "signature-list",
    type: "entityList",
    entity: SIGNATURE_REQUEST_ENTITY,
    columns: [
      "title",
      "status",
      "subjectType",
      { field: "expiresAt", hideOnNarrow: true },
      { field: "completedAt", hideOnNarrow: true },
    ],
    defaultSort: { field: "expiresAt", dir: "desc" },
    access,
    searchable: true,
    rowActions: [
      {
        kind: "navigate",
        id: "open",
        label: i18nKey("signature.action.open"),
        screen: "signature-detail",
        entityId: "id",
        rowClick: true,
      },
      CANCEL_ACTION,
    ],
  };
}

// Signing in person needs the drawing pad, which a declarative screen cannot host: the app mounts
// SignaturePad on its own screen and calls sign-in-person.
export function createSignatureDetailScreen(
  access: ProjectionDetailScreenDefinition["access"],
): ProjectionDetailScreenDefinition {
  return {
    id: "signature-detail",
    type: "projectionDetail",
    dormant: true,
    listScreenId: "signature-list",
    query: SignatureQueries.detail,
    access,
    header: { title: "title", status: "status" },
    fieldLabels: {
      status: i18nKey(`${REQUEST}:status`),
      subjectType: i18nKey(`${REQUEST}:subjectType`),
      expiresAt: i18nKey(`${REQUEST}:expiresAt`),
      completedAt: i18nKey(`${REQUEST}:completedAt`),
    },
    actions: [CANCEL_ACTION],
    layout: {
      sections: [
        { fields: ["status", "subjectType", "expiresAt", "completedAt"] },
        {
          kind: "relatedList",
          title: i18nKey("signature.signers.title"),
          query: SignatureQueries.signerList,
          parentFilter: { field: "requestId" },
          entity: SIGNATURE_SIGNER_ENTITY,
          columns: ["name", "role", "status", "method", { field: "signedAt", hideOnNarrow: true }],
          rowActions: [
            {
              id: "issue-link",
              label: i18nKey("signature.action.issueLink"),
              handler: SignatureHandlers.issueLink,
              payload: { map: { signerId: "id" } },
              visible: UNSIGNED_SIGNER,
            },
            {
              id: "revoke-link",
              label: i18nKey("signature.action.revokeLink"),
              handler: SignatureHandlers.revokeLink,
              payload: { map: { signerId: "id" } },
              confirm: i18nKey("signature.action.revokeLink.confirm"),
              style: "danger",
              visible: UNSIGNED_SIGNER,
            },
          ],
        },
      ],
    },
  };
}
