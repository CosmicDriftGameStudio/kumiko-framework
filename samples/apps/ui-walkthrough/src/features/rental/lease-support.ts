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

// Walkthrough shortcut, not the pattern: a real handler reads the photo ids from the stored record, never from the client.
export const propertyExposePayloadSchema = z.object({
  propertyAddress: z.string().min(1),
  propertySummary: z.string().min(1),
  photos: z.array(z.uuid()).max(10),
});

// Walkthrough shortcut, not the pattern: real screens resolve FileRefs from the record, never from route-supplied ids.
export const fileRefIdsPayloadSchema = z.object({
  id: z
    .string()
    .transform((raw) => raw.split(","))
    .pipe(z.array(z.uuid()).min(1).max(10)),
});

export const rentAdjustPayloadSchema = z.object({
  positionId: z.uuid(),
  wirksamAb: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  einzelpreis: z.object({ amount: z.number(), currency: z.string() }).optional(),
  neuerBetrag: z.object({ amount: z.number(), currency: z.string() }),
  begruendung: z.string().optional(),
});

const moneySchema = z.object({ amount: z.number(), currency: z.string() });

export const POSITION_KINDS = ["grundmiete", "nebenkosten", "heizkosten", "stellplatz"] as const;
export const POSITION_MEASURES = ["monat", "quadratmeter", "stueck"] as const;
export const PAYMENT_METHODS = ["ueberweisung", "lastschrift", "dauerauftrag"] as const;

export const recordPositionsPayloadSchema = z.object({
  lease: z.uuid(),
  zahlungsweise: z.enum(PAYMENT_METHODS).optional(),
  items: z
    .array(
      z.object({
        unit: z.uuid(),
        kind: z.enum(POSITION_KINDS),
        quantity: z.number(),
        measure: z.enum(POSITION_MEASURES),
        unitPrice: moneySchema,
        vatRate: z.number().optional(),
        validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        validTo: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
      }),
    )
    .min(1),
});

export type RecordedPositionItem = z.output<typeof recordPositionsPayloadSchema>["items"][number];

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
  ende: readDateSchema.nullish(),
  vorgaenger: z.string().nullish(),
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

export function germanStatusLabel(status: string, ende?: string | null): string {
  if (status === "terminated" && ende) return `Gekündigt zum ${formatGermanDate(ende)}`;
  return GERMAN_STATUS_LABEL[status] ?? status;
}

// Tenant notice (§ 573c BGB, simplified to the 3rd calendar day instead of the
// 3rd working day): notice received by then ends the lease after the month after
// next, later notice one month later.
export function noticePeriodEnd(isoToday: string): string {
  const today = getTemporal().PlainDate.from(isoToday);
  const target = today.add({ months: today.day <= 3 ? 2 : 3 });
  return target.with({ day: target.daysInMonth }).toString();
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
