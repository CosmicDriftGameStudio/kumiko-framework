// Config stress test (server). The shadcn reference designs are NOT hand-built
// but generated 1:1 from the schema — to see what the auto-UI supports and
// where it hits limits. First case: "Shipping Address" (flat form,
// 2-field rows, custom submit label).

import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { EXAMPLES_I18N } from "./i18n";
import { deliveryEntity, inspectionEntity, profileEntity, shippingEntity } from "./schema";

const openReason =
  "demo app: any signed-in user edits the shipping, profile and delivery example " +
  "forms; there is no per-user ownership in this sample";
const editFormOnly = {
  write: { access: { openToAll: { reason: openReason, personalData: "tenant-members" } } },
  read: { access: { openToAll: { reason: openReason } } },
  verbs: { delete: false, list: false, restore: false },
} as const;

export const examplesFeature = defineFeature("examples", (r) => {
  r.translations({ keys: EXAMPLES_I18N });
  r.crud(shippingEntity, editFormOnly);

  // ONE untitled section: card title + subtitle (from i18n) carry the
  // context, the fields flow directly below. street/apt/saveAsDefault
  // span both columns (full width), city/state + zip/country share
  // one row each.
  r.screen({
    id: "shipping-edit",
    type: "entityEdit",
    entity: "shipping",
    submitLabel: "examples:shipping:submit",
    layout: {
      sections: [
        {
          columns: 2,
          fields: [
            { field: "street", span: 2 },
            { field: "apt", span: 2 },
            "city",
            "state",
            "zip",
            "country",
            { field: "saveAsDefault", span: 2 },
          ],
        },
      ],
    },
  });

  r.crud(profileEntity, {
    ...editFormOnly,
    verbs: { delete: false, restore: false },
  });

  r.screen({
    id: "profile-list",
    type: "entityList",
    entity: "profile",
    dormant: true,
    columns: ["avatar", "fullName", "email"],
    searchable: true,
    defaultSort: { field: "email", dir: "asc" },
    rowActions: [
      {
        kind: "navigate",
        id: "view",
        label: "examples:profile:view",
        screen: "profile-view",
        entityId: "id",
        rowClick: true,
      },
    ],
    access: { openToAll: { reason: openReason } },
  });

  r.screen({
    id: "profile-view",
    type: "entityEdit",
    entity: "profile",
    dormant: true,
    listScreenId: "profile-list",
    layout: {
      sections: [
        {
          columns: 2,
          fields: [
            { field: "avatar", span: 2, readOnly: true },
            { field: "fullName", readOnly: true },
            { field: "email", readOnly: true },
          ],
        },
      ],
    },
  });

  r.screen({
    id: "profile-edit",
    type: "entityEdit",
    entity: "profile",
    submitLabel: "examples:profile:submit",
    layout: {
      sections: [
        {
          columns: 2,
          fields: [{ field: "avatar", span: 2 }, "fullName", "email", { field: "bio", span: 2 }],
        },
      ],
    },
  });

  r.crud(deliveryEntity, editFormOnly);

  r.screen({
    id: "delivery-edit",
    type: "entityEdit",
    entity: "delivery",
    submitLabel: "examples:delivery:submit",
    layout: {
      sections: [
        {
          columns: 2,
          fields: [
            { field: "label", span: 2 },
            { field: "pickup", span: 2 },
            "dropoffOn",
            "homeZone",
            { field: "bookedAt", span: 2 },
          ],
        },
      ],
    },
  });

  r.crud(inspectionEntity, editFormOnly);

  r.screen({
    id: "inspection-edit",
    type: "entityEdit",
    entity: "inspection",
    submitLabel: "examples:inspection:submit",
    layout: {
      width: "full",
      sections: [
        {
          columns: 1,
          fields: [
            "measuringDevice",
            {
              field: "checkpoints",
              embeddedList: {
                readOnlyCells: ["label", "kind", "min", "max"],
                cardHiddenCells: ["kind"],
                fixedRows: true,
              },
            },
          ],
        },
        { columns: 1, fields: ["continuedOperation", "condition"] },
      ],
    },
  });

  r.nav({ id: "examples", label: "examples:nav.examples", icon: "folder", order: 30 });
  r.nav({
    id: "shipping",
    label: "examples:nav.shipping",
    parent: "examples:nav:examples",
    screen: "examples:screen:shipping-edit",
    icon: "file",
    order: 10,
  });
  r.nav({
    id: "profile",
    label: "examples:nav.profile",
    parent: "examples:nav:examples",
    screen: "examples:screen:profile-edit",
    icon: "user",
    order: 20,
  });
  r.nav({
    id: "delivery",
    label: "examples:nav.delivery",
    parent: "examples:nav:examples",
    screen: "examples:screen:delivery-edit",
    icon: "calendar",
    order: 30,
  });
  r.nav({
    id: "inspection",
    label: "examples:nav.inspection",
    parent: "examples:nav:examples",
    screen: "examples:screen:inspection-edit",
    icon: "file",
    order: 40,
  });
});
