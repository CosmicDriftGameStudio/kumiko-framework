import { defineFeature, i18nKey } from "@cosmicdrift/kumiko-framework/engine";
import { failNotFound } from "@cosmicdrift/kumiko-framework/errors";
import { z } from "zod";
import { openToAllSignedIn, toKeyFirst } from "../translations";
import { leaseEntity, leasePartyEntity, leasePositionEntity } from "./entities";
import { rentalTranslations } from "./i18n";
import {
  dayBefore,
  formatGermanDate,
  formatGermanMoney,
  germanStatusLabel,
  idPayloadSchema,
  leaseExecutor,
  parseLeaseRow,
  partyExecutor,
  positionExecutor,
  positionListRowSchema,
  positionRowSchema,
  type RecordedPositionItem,
  recordPositionsPayloadSchema,
  rentAdjustPayloadSchema,
} from "./lease-support";
import {
  adjustRentScreen,
  leaseDetailScreen,
  leaseEditScreen,
  leaseHubScreen,
  leaseListScreen,
  leaseListShortScreen,
  partyEditScreen,
  positionEditScreen,
  recordPositionsScreen,
  rentalDashboardScreen,
} from "./screens";

export { leaseEntity, leasePartyEntity, leasePositionEntity };

const open = openToAllSignedIn(
  "demo app: any signed-in user manages every lease; there is no per-user ownership in this sample",
);

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
      amount: item.unitPrice.amount * item.quantity,
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
  r.crud("leaseParty", leasePartyEntity, { write: open, read: open });

  r.queryHandler(
    "lease:akte",
    idPayloadSchema,
    async (query, ctx) => {
      const row = await leaseExecutor.detail({ id: query.payload.id }, query.user, ctx.db);
      if (!row) return failNotFound("lease", query.payload.id);
      const lease = parseLeaseRow(row);
      const countChildren = async (executor: typeof positionExecutor): Promise<number> => {
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
        standort: [lease.einheit, lease.liegenschaft].filter(Boolean).join(" · "),
        statusLabel: germanStatusLabel(lease.status),
        grundmiete: formatGermanMoney(lease.grundmiete),
        beginn: formatGermanDate(lease.beginn),
        kuendigungsfrist: lease.kuendigungsfrist ?? "",
        zahltag: lease.zahltag != null ? `Tag ${lease.zahltag}` : "",
        einheit: lease.einheit ?? "",
        liegenschaft: lease.liegenschaft ?? "",
        ende: "",
        kontostand: "0,00 €",
        notizen: "",
        partyCount: await countChildren(partyExecutor),
        positionCount: await countChildren(positionExecutor),
      };
    },
    open,
  );

  r.queryHandler(
    "lease:positions",
    idPayloadSchema,
    async (query, ctx) => {
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
    open,
  );

  r.queryHandler(
    "lease:kennzahlen",
    z.object({}),
    async () => ({
      debt: "123.456 €",
      debtSub: "nach 10 Jahren",
      debtDelta: "15 %",
      debtDeltaDirection: "down",
      rent: "48.200 €",
      rentSub: "319 Verträge",
    }),
    open,
  );

  r.writeHandler(
    "lease:terminate",
    idPayloadSchema,
    async (event, ctx) =>
      leaseExecutor.update(
        {
          id: event.payload.id,
          changes: { status: "terminated", ende: ctx.tz.today(ctx.tz.tenant).toString() },
        },
        event.user,
        ctx.db,
        { skipOptimisticLock: true },
      ),
    open,
  );

  r.writeHandler(
    "lease:record-positions",
    recordPositionsPayloadSchema,
    async (event, ctx) => {
      let created: Awaited<ReturnType<typeof positionExecutor.create>> | undefined;
      for (const item of event.payload.items) {
        const unitRow = await leaseExecutor.detail({ id: item.unit }, event.user, ctx.db);
        if (!unitRow) return failNotFound("lease", item.unit);
        created = await positionExecutor.create(
          positionFromItem(event.payload.lease, parseLeaseRow(unitRow).einheit, item),
          event.user,
          ctx.db,
        );
        if (!created.isSuccess) return created;
      }
      return created ?? failNotFound("leasePosition", event.payload.lease);
    },
    open,
  );

  r.writeHandler(
    "rent:adjust",
    rentAdjustPayloadSchema,
    async (event, ctx) => {
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
    open,
  );

  r.screen(leaseListScreen);
  r.screen(leaseListShortScreen);
  r.screen(leaseEditScreen);
  r.screen(positionEditScreen);
  r.screen(partyEditScreen);
  r.screen(leaseDetailScreen);
  r.screen(leaseHubScreen);
  r.screen(rentalDashboardScreen);
  r.screen(adjustRentScreen);
  r.screen(recordPositionsScreen);

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
});
