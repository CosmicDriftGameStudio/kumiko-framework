import { defineFeature, i18nKey } from "@cosmicdrift/kumiko-framework/engine";
import { failNotFound } from "@cosmicdrift/kumiko-framework/errors";
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
  rentAdjustPayloadSchema,
} from "./lease-support";
import {
  adjustRentScreen,
  leaseDetailScreen,
  leaseEditScreen,
  leaseListScreen,
  leaseListShortScreen,
  positionEditScreen,
} from "./screens";

export { leaseEntity, leasePartyEntity, leasePositionEntity };

const open = openToAllSignedIn(
  "demo app: any signed-in user manages every lease; there is no per-user ownership in this sample",
);

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
  r.screen(leaseDetailScreen);
  r.screen(adjustRentScreen);

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
});
