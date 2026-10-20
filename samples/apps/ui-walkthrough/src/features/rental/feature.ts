import type { EventStoreExecutor } from "@cosmicdrift/kumiko-framework/db";
import { defineFeature, defineWriteHandler, i18nKey } from "@cosmicdrift/kumiko-framework/engine";
import { failNotFound } from "@cosmicdrift/kumiko-framework/errors";
import {
  renderPdfBeforeTransaction,
  storeRenderedPdf,
} from "@cosmicdrift/kumiko-renderer-puppeteer-client";
import { z } from "zod";
import { openToAllSignedIn, toKeyFirst } from "../translations";
import { leaseEntity, leasePartyEntity, leasePositionEntity } from "./entities";
import { rentalTranslations } from "./i18n";
import { receiveInvoicePayloadSchema } from "./invoice-receive";
import {
  dayBefore,
  fileRefIdsPayloadSchema,
  formatGermanDate,
  formatGermanMoney,
  germanStatusLabel,
  idPayloadSchema,
  leaseExecutor,
  noticePeriodEnd,
  parseLeaseRow,
  partyExecutor,
  positionExecutor,
  positionListRowSchema,
  positionRowSchema,
  propertyExposePayloadSchema,
  type RecordedPositionItem,
  recordPositionsPayloadSchema,
  rentAdjustPayloadSchema,
} from "./lease-support";
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
  partyEditScreen,
  positionEditScreen,
  receiveInvoiceScreen,
  recordPositionsScreen,
  rentalDashboardScreen,
} from "./screens";

export { leaseEntity, leasePartyEntity, leasePositionEntity };

const open = openToAllSignedIn(
  "demo app: any signed-in user manages every lease; there is no per-user ownership in this sample",
);

const roundToCents = (amount: number): number => Math.round(amount * 100) / 100;

// measure and vatRate only exist to give the walkthrough form realistic column
// types; leasePosition has no fields for them.
function positionFromItem(
  lease: string,
  unitLabel: string | null | undefined,
  item: RecordedPositionItem,
) {
  return {
    lease,
    art: item.kind,
    ...(unitLabel && { einheit: unitLabel }),
    betrag: {
      amount: roundToCents(item.unitPrice.amount * item.quantity),
      currency: item.unitPrice.currency,
    },
    gueltigVon: item.validFrom,
    ...(item.validTo && { gueltigBis: item.validTo }),
  };
}

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

  r.queryHandler({
    name: "lease:unterlagen",
    schema: fileRefIdsPayloadSchema,
    handler: async (query) => ({
      id: "unterlagen",
      titel: "Unterlagen",
      unterlagen: query.payload.id,
    }),
    ...open,
  });

  r.queryHandler({
    name: "lease:akte",
    schema: idPayloadSchema,
    handler: async (query, ctx) => {
      const row = await leaseExecutor.detail({ id: query.payload.id }, query.user, ctx.db);
      if (!row) return failNotFound("lease", query.payload.id);
      const lease = parseLeaseRow(row);
      const countChildren = async (executor: EventStoreExecutor): Promise<number> => {
        const page = await executor.list(
          { filter: { field: "lease", op: "eq", value: lease.id }, limit: 1, totalCount: true },
          query.user,
          ctx.db,
        );
        return page.total ?? page.rows.length;
      };
      return {
        id: lease.id,
        mieter: lease.mieter,
        status: lease.status,
        statusLabel: germanStatusLabel(lease.status, lease.ende),
        grundmiete: formatGermanMoney(lease.grundmiete),
        beginn: formatGermanDate(lease.beginn),
        kuendigungsfrist: lease.kuendigungsfrist ?? "",
        zahltag: lease.zahltag != null ? `Tag ${lease.zahltag}` : "",
        einheit: lease.einheit ?? "",
        liegenschaft: lease.liegenschaft ?? "",
        ende: "",
        vorgaenger: lease.vorgaenger ?? "",
        kontostand: "0,00 €",
        notizen: "",
        partyCount: await countChildren(partyExecutor),
        positionCount: await countChildren(positionExecutor),
      };
    },
    ...open,
  });

  r.queryHandler({
    name: "lease:positions",
    schema: idPayloadSchema,
    handler: async (query, ctx) => {
      const page = await positionExecutor.list(
        { filter: { field: "lease", op: "eq", value: query.payload.id }, limit: 100 },
        query.user,
        ctx.db,
      );
      return {
        rows: page.rows.map((row) => {
          const position = positionListRowSchema.parse(row);
          return {
            id: position.id,
            art: position.art,
            einheit: position.einheit ?? "",
            betrag: formatGermanMoney(position.betrag),
            betragWert: position.betrag,
            gueltigVonIso: position.gueltigVon.toString(),
            gueltigVon: formatGermanDate(position.gueltigVon),
            gueltigBis: position.gueltigBis ? formatGermanDate(position.gueltigBis) : "–",
          };
        }),
      };
    },
    ...open,
  });

  r.queryHandler({
    name: "lease:kennzahlen",
    schema: z.object({}),
    handler: async () => ({
      debt: "123.456 €",
      debtSub: "nach 10 Jahren",
      debtDelta: "15 %",
      debtDeltaDirection: "down",
      rent: "48.200 €",
      rentSub: "319 Verträge",
    }),
    ...open,
  });

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

  r.writeHandler({
    name: "lease:record-positions",
    schema: recordPositionsPayloadSchema,
    handler: async (event, ctx) => {
      let created: Awaited<ReturnType<typeof positionExecutor.create>> | undefined;
      const unitLabels = new Map<string, string | null | undefined>();
      for (const unitId of new Set(event.payload.items.map((item) => item.unit))) {
        const unitRow = await leaseExecutor.detail({ id: unitId }, event.user, ctx.db);
        if (!unitRow) return failNotFound("lease", unitId);
        unitLabels.set(unitId, parseLeaseRow(unitRow).einheit);
      }
      for (const item of event.payload.items) {
        created = await positionExecutor.create(
          positionFromItem(event.payload.lease, unitLabels.get(item.unit), item),
          event.user,
          ctx.db,
        );
        if (!created.isSuccess) return created;
      }
      return created ?? failNotFound("leasePosition", event.payload.lease);
    },
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

  r.writeHandler({
    name: "rent:adjust",
    schema: rentAdjustPayloadSchema,
    handler: async (event, ctx) => {
      const { positionId, wirksamAb, neuerBetrag } = event.payload;
      const current = await positionExecutor.detail({ id: positionId }, event.user, ctx.db);
      if (!current) return failNotFound("leasePosition", positionId);
      const position = positionRowSchema.parse(current);

      const endOld = await positionExecutor.update(
        { id: positionId, changes: { gueltigBis: dayBefore(wirksamAb) } },
        event.user,
        ctx.db,
        { skipOptimisticLock: true },
      );
      if (!endOld.isSuccess) return endOld;

      const startNew = await positionExecutor.create(
        {
          lease: position.lease,
          art: position.art,
          einheit: position.einheit ?? "",
          betrag: neuerBetrag,
          gueltigVon: wirksamAb,
        },
        event.user,
        ctx.db,
      );
      if (!startNew.isSuccess) return startNew;

      return leaseExecutor.update(
        { id: position.lease, changes: { grundmiete: neuerBetrag } },
        event.user,
        ctx.db,
        { skipOptimisticLock: true },
      );
    },
    ...open,
  });

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
  r.screen({
    id: "upload-standard-layout",
    type: "custom",
    renderer: { react: { __component: "upload-standard-layout" } },
    description: "Receipt upload on the standard form screen layout.",
  });

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
