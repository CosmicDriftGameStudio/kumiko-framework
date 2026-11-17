import { defineFeature, defineWriteHandler, i18nKey } from "@cosmicdrift/kumiko-framework/engine";
import {
  renderPdfBeforeTransaction,
  storeRenderedPdf,
} from "@cosmicdrift/kumiko-renderer-puppeteer-client";
import { z } from "zod";
import { toKeyFirst } from "../translations";
import { open } from "./access";
import {
  leaseEntity,
  leasePartyEntity,
  leasePositionEntity,
  managementProfileEntity,
  receiptEntity,
} from "./entities";
import { leaseAkteQuery } from "./handlers/lease-akte.query";
import { leaseKennzahlenQuery } from "./handlers/lease-kennzahlen.query";
import { leasePositionsQuery } from "./handlers/lease-positions.query";
import { leaseRecordPositionsWrite } from "./handlers/lease-record-positions.write";
import { leaseUnterlagenQuery } from "./handlers/lease-unterlagen.query";
import { rentAdjustWrite } from "./handlers/rent-adjust.write";
import { rentalTranslations } from "./i18n";
import { receiveInvoicePayloadSchema } from "./invoice-receive";
import {
  idPayloadSchema,
  leaseExecutor,
  managementProfileExecutor,
  noticePeriodEnd,
  propertyExposePayloadSchema,
  saveManagementProfilePayloadSchema,
} from "./lease-support";
import { receiptsUploadPayloadSchema, uploadReceipts } from "./receipts-upload";
import {
  adjustRentScreen,
  leaseDetailGapsScreen,
  leaseDetailScreen,
  leaseEditScreen,
  leaseHubScreen,
  leaseListEmptyScreen,
  leaseListScreen,
  leaseListShortScreen,
  leaseSuccessionListScreen,
  leaseUnterlagenScreen,
  managementProfileScreen,
  partyEditScreen,
  positionEditScreen,
  receiveInvoiceScreen,
  recordPositionsScreen,
  rentalDashboardScreen,
  uploadReceiptsScreen,
} from "./screens";

export { leaseEntity, leasePartyEntity, leasePositionEntity };

export const rentalFeature = defineFeature("rental", (r) => {
  r.translations({ keys: toKeyFirst(rentalTranslations) });

  r.crud("lease", leaseEntity, { write: open, read: open });
  r.crud("leasePosition", leasePositionEntity, { write: open, read: open });
  // Only the interactive create path is guarded; recordPositions and adjustRent
  // write through the executor and compute their own date ranges.
  r.hook({
    type: "validation",
    target: "lease-position:create",
    handler: (data) => {
      const { gueltigVon, gueltigBis } = data;
      if (
        typeof gueltigVon === "string" &&
        typeof gueltigBis === "string" &&
        gueltigBis < gueltigVon
      ) {
        // The "(root)" issue has no rendered field, so the form also shows its
        // error banner next to the field error.
        return [
          { field: "gueltigBis", error: "valid_until_before_valid_from" },
          { field: "(root)", error: "position_period_invalid" },
        ];
      }
      return null;
    },
  });
  r.crud("leaseParty", leasePartyEntity, { write: open, read: open });

  r.queryHandler(leaseUnterlagenQuery);

  r.queryHandler(leaseAkteQuery);

  r.queryHandler(leasePositionsQuery);

  r.queryHandler(leaseKennzahlenQuery);

  r.writeHandler({
    name: "lease:terminate",
    schema: idPayloadSchema,
    handler: async (event, ctx) =>
      leaseExecutor.update(
        {
          id: event.payload.id,
          changes: {
            status: "terminated",
            ende: noticePeriodEnd(ctx.tz.today(ctx.tz.tenant).toString()),
          },
        },
        event.user,
        ctx.db,
        { skipOptimisticLock: true },
      ),
    ...open,
  });

  r.writeHandler(leaseRecordPositionsWrite);

  r.entity({ name: "receipt", ...receiptEntity });
  // One row per tenant: the profile screen loads it without a record id.
  r.entity({ name: "managementProfile", ...managementProfileEntity });

  r.queryHandler({
    name: "profile:current",
    schema: z.object({}),
    handler: async (query, ctx) => {
      const page = await managementProfileExecutor.list({ limit: 1 }, query.user, ctx.db);
      return page.rows[0] ?? null;
    },
    ...open,
  });

  r.writeHandler({
    name: "profile:save",
    schema: saveManagementProfilePayloadSchema,
    handler: async (event, ctx) => {
      const page = await managementProfileExecutor.list({ limit: 1 }, event.user, ctx.db);
      const existing = page.rows[0];
      if (existing === undefined) {
        return managementProfileExecutor.create(event.payload, event.user, ctx.db);
      }
      return managementProfileExecutor.update(
        { id: String(existing["id"]), changes: event.payload },
        event.user,
        ctx.db,
        { skipOptimisticLock: true },
      );
    },
    ...open,
  });

  r.writeHandler({
    name: "receipts-upload",
    schema: receiptsUploadPayloadSchema,
    handler: uploadReceipts,
    ...open,
  });

  r.writeHandler({
    name: "invoice:receive",
    schema: receiveInvoicePayloadSchema,
    handler: async (event) => ({ isSuccess: true, data: event.payload }),
    ...open,
  });

  r.writeHandler(
    defineWriteHandler({
      name: "generate-property-expose",
      schema: propertyExposePayloadSchema,
      access: { roles: ["TenantAdmin"] },
      beforeTransaction: async (event, ctx) =>
        renderPdfBeforeTransaction(ctx, {
          slug: "rental:property-expose",
          locale: "de",
          variables: event.payload,
        }),
      handler: async (event, ctx) => storeRenderedPdf(ctx, event.prepared),
    }),
  );

  r.writeHandler(rentAdjustWrite);

  r.screen(leaseListScreen);
  r.screen(leaseListShortScreen);
  r.screen(leaseEditScreen);
  r.screen(positionEditScreen);
  r.screen(partyEditScreen);
  r.screen(leaseDetailScreen);
  r.screen(leaseHubScreen);
  r.screen(leaseDetailGapsScreen);
  r.screen(leaseListEmptyScreen);
  r.screen(leaseSuccessionListScreen);
  r.screen(rentalDashboardScreen);
  r.screen(adjustRentScreen);
  r.screen(recordPositionsScreen);
  r.screen(receiveInvoiceScreen);
  r.screen(leaseUnterlagenScreen);
  r.screen(uploadReceiptsScreen);
  r.screen(managementProfileScreen);

  r.nav({
    id: "contracts",
    label: i18nKey("rental.nav.contracts"),
    order: 30,
  });
  r.nav({
    id: "lease-list",
    label: i18nKey("rental.nav.leases"),
    parent: "rental:nav:contracts",
    screen: "rental:screen:lease-list",
    order: 10,
  });
  r.nav({
    id: "rental-dashboard",
    label: i18nKey("rental.nav.dashboard"),
    parent: "rental:nav:contracts",
    screen: "rental:screen:rental-dashboard",
    order: 20,
  });
  r.nav({
    id: "management-profile",
    label: i18nKey("rental.nav.managementProfile"),
    parent: "rental:nav:contracts",
    screen: "rental:screen:management-profile",
    order: 50,
  });
  r.nav({
    id: "receive-invoice",
    label: i18nKey("rental.nav.receiveInvoice"),
    parent: "rental:nav:contracts",
    screen: "rental:screen:receive-invoice",
    order: 40,
  });
  r.nav({
    id: "upload-standard-layout",
    label: i18nKey("rental.nav.upload"),
    parent: "rental:nav:contracts",
    screen: "rental:screen:upload-standard-layout",
    order: 30,
  });
});
