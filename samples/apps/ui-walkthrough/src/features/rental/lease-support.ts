import { createEntityExecutor } from "@cosmicdrift/kumiko-framework/engine";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import { z } from "zod";
import { leaseEntity, leasePartyEntity, leasePositionEntity } from "./entities";

export const { executor: leaseExecutor } = createEntityExecutor("lease", leaseEntity);
export const { executor: positionExecutor } = createEntityExecutor(
  "leasePosition",
  leasePositionEntity,
);
export const { executor: partyExecutor } = createEntityExecutor("leaseParty", leasePartyEntity);

export const idPayloadSchema = z.object({ id: z.uuid() });

export const rentAdjustPayloadSchema = z.object({
  positionId: z.uuid(),
  wirksamAb: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  einzelpreis: z.object({ amount: z.number(), currency: z.string() }).optional(),
  neuerBetrag: z.object({ amount: z.number(), currency: z.string() }),
  begruendung: z.string().optional(),
});

const moneySchema = z.object({ amount: z.number(), currency: z.string() });

const readDateSchema = z
  .custom<{ toString(): string }>((value) => value !== null && value !== undefined)
  .transform(String);

const leaseRowSchema = z.object({
  id: z.string(),
  mieter: z.string(),
  einheit: z.string().nullish(),
  liegenschaft: z.string().nullish(),
  beginn: readDateSchema,
  status: z.string(),
  grundmiete: moneySchema,
  kuendigungsfrist: z.string().nullish(),
  zahltag: z.number().nullish(),
});

export const positionRowSchema = z.object({
  id: z.string(),
  lease: z.string(),
  art: z.string(),
  einheit: z.string().nullish(),
  betrag: moneySchema,
});

export const positionListRowSchema = positionRowSchema.extend({
  gueltigVon: readDateSchema,
  gueltigBis: readDateSchema.nullish(),
});

export type LeaseRow = z.infer<typeof leaseRowSchema>;

export function parseLeaseRow(row: unknown): LeaseRow {
  return leaseRowSchema.parse(row);
}

const GERMAN_STATUS_LABEL: Readonly<Record<string, string>> = {
  active: "Aktiv",
  terminated: "Gekündigt",
};

export function germanStatusLabel(status: string): string {
  return GERMAN_STATUS_LABEL[status] ?? status;
}

export function formatGermanDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  return `${day}.${month}.${year}`;
}

export function formatGermanMoney(money: z.infer<typeof moneySchema>): string {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: money.currency }).format(
    money.amount,
  );
}

export function dayBefore(isoDate: string): string {
  return getTemporal().PlainDate.from(isoDate).subtract({ days: 1 }).toString();
}
