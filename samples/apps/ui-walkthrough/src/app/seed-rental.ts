// Board rows carry fixed ascending ids: the list ties on `beginn` (many equal
// dates) and breaks by id ASC, so the screenshot order is reproducible.

import type { SeedFn } from "@cosmicdrift/kumiko-dev-server";
import { createTenantDb } from "@cosmicdrift/kumiko-framework/db";
import { TestUsers } from "@cosmicdrift/kumiko-framework/stack";
import { countRowsForTenant } from "../db/queries/row-counts";
import { leaseExecutor, partyExecutor, positionExecutor } from "../features/rental/lease-support";

type BoardLease = {
  readonly mieter: string;
  readonly einheit: string;
  readonly liegenschaft: string;
  readonly beginn: string;
  readonly ende?: string;
  readonly miete: number;
};

const BOARD_LEASES: readonly BoardLease[] = [
  {
    mieter: "Otto Freihand",
    einheit: "WE-42",
    liegenschaft: "Haus Freihandweg",
    beginn: "2026-10-01",
    miete: 720,
  },
  {
    mieter: "Tobias Treuhand",
    einheit: "WE-32",
    liegenschaft: "Haus Ulmenpark",
    beginn: "2026-09-01",
    miete: 690,
  },
  {
    mieter: "Max Nachmieter",
    einheit: "WE-12",
    liegenschaft: "Haus Ahornweg",
    beginn: "2026-09-01",
    miete: 850,
  },
  {
    mieter: "Petra Pfand",
    einheit: "WE-31",
    liegenschaft: "Haus Pappelhof",
    beginn: "2026-09-01",
    miete: 640,
  },
  {
    mieter: "Sina Kautionsfall",
    einheit: "WE-41",
    liegenschaft: "Haus Kautionsweg",
    beginn: "2026-09-01",
    miete: 610,
  },
  {
    mieter: "Erika Musterfrau",
    einheit: "WE-11",
    liegenschaft: "Haus Lindenstraße",
    beginn: "2026-09-01",
    miete: 780,
  },
  {
    mieter: "Thomas Bergmann",
    einheit: "WE-05",
    liegenschaft: "Haus Kastanienallee (Vertrag)",
    beginn: "2026-09-01",
    miete: 705,
  },
  {
    mieter: "Sabine Hoffmann",
    einheit: "WE-21",
    liegenschaft: "Nordring 14",
    beginn: "2026-06-01",
    miete: 815,
  },
  {
    mieter: "Meier Handels GmbH",
    einheit: "Stellplatz 15, Stellplatz 16, Stellplatz 14, EG, Stellplatz 13, Stellplatz 12",
    liegenschaft: "Hauptstraße, Köln",
    beginn: "2026-03-01",
    miete: 1450,
  },
  {
    mieter: "Meier Handels GmbH",
    einheit: "Stellplatz 16, Stellplatz 13, Stellplatz 15, Stellplatz 14, EG, Stellplatz 12",
    liegenschaft: "Hauptstraße, Köln",
    beginn: "2026-03-01",
    miete: 1450,
  },
  {
    mieter: "Nora Mietanpassung",
    einheit: "WE-51",
    liegenschaft: "Haus Kastanienallee",
    beginn: "2026-01-01",
    miete: 665,
  },
  {
    mieter: "Otto Ausgezogen2",
    einheit: "WE-42",
    liegenschaft: "Haus Ulmenhof",
    beginn: "2026-01-01",
    ende: "2026-08-31",
    miete: 700,
  },
  {
    mieter: "Karl Positionsende",
    einheit: "WE-51",
    liegenschaft: "Haus Kastanienweg",
    beginn: "2026-01-01",
    miete: 655,
  },
  {
    mieter: "Uwe Auszieher",
    einheit: "WE-61",
    liegenschaft: "Haus Erlenweg",
    beginn: "2026-01-01",
    miete: 630,
  },
  {
    mieter: "Otto Zweitposition",
    einheit: "WE-52",
    liegenschaft: "Haus Fliederweg",
    beginn: "2026-01-01",
    miete: 670,
  },
  {
    mieter: "Rita Ausgelaufen",
    einheit: "WE-52",
    liegenschaft: "Haus Fliederweg",
    beginn: "2026-01-01",
    miete: 660,
  },
  {
    mieter: "Otto Ausgezogen",
    einheit: "WE-32",
    liegenschaft: "Haus Lindenhof",
    beginn: "2026-01-01",
    ende: "2026-08-31",
    miete: 645,
  },
  {
    mieter: "Nora Zusatzpartei",
    einheit: "WE-41",
    liegenschaft: "Haus Birkenweg",
    beginn: "2026-01-01",
    miete: 620,
  },
  {
    mieter: "Nora Zusatzposten",
    einheit: "WE-31",
    liegenschaft: "Haus Ahornweg",
    beginn: "2026-01-01",
    miete: 635,
  },
];

const MAX_NACHMIETER_INDEX = 2;
const GENERATED_LEASE_COUNT = 300;
const FIRST_NAMES = [
  "Anna",
  "Ben",
  "Clara",
  "David",
  "Elif",
  "Felix",
  "Greta",
  "Hannes",
  "Ida",
  "Jonas",
];
const LAST_NAMES = [
  "Albrecht",
  "Brandt",
  "Conrad",
  "Dietrich",
  "Engel",
  "Fischer",
  "Graf",
  "Hartmann",
];
const PROPERTIES = ["Haus Eichenweg", "Haus Buchenring", "Haus Tannenhof", "Haus Weidenpfad"];

function boardLeaseId(index: number): string {
  return `00000000-0000-4000-8000-${String(3100 + index + 1).padStart(12, "0")}`;
}

function eur(amount: number) {
  return { amount, currency: "EUR" } as const;
}

function generatedLease(index: number): BoardLease & { readonly terminated: boolean } {
  const month = String((index % 12) + 1).padStart(2, "0");
  const year = 2025 - Math.floor(index / 150);
  const terminated = index === 0;
  return {
    mieter: `${FIRST_NAMES[index % FIRST_NAMES.length]} ${LAST_NAMES[index % LAST_NAMES.length]}`,
    einheit: `WE-${String(100 + index)}`,
    liegenschaft: PROPERTIES[index % PROPERTIES.length] ?? "Haus Eichenweg",
    beginn: `${year}-${month}-01`,
    ...(terminated && { ende: "2025-12-31" }),
    miete: 500 + (index % 20) * 15,
    terminated,
  };
}

export const seedRental: SeedFn = async (stack) => {
  const { tenantId } = TestUsers.admin;
  if ((await countRowsForTenant(stack.db, "read_ui_walkthrough_leases", tenantId)) > 0) return;
  const db = createTenantDb(stack.db, tenantId);

  const createLease = async (lease: BoardLease, terminated: boolean, id?: string) => {
    const result = await leaseExecutor.create(
      {
        ...(id && { id }),
        mieter: lease.mieter,
        einheit: lease.einheit,
        liegenschaft: lease.liegenschaft,
        beginn: lease.beginn,
        ...(lease.ende && { ende: lease.ende }),
        status: terminated ? "terminated" : "active",
        grundmiete: eur(lease.miete),
        kuendigungsfrist: "3 Monate",
        zahltag: 3,
      },
      TestUsers.admin,
      db,
    );
    if (!result.isSuccess) throw new Error(`seed lease "${lease.mieter}" failed`);
  };

  for (const [index, lease] of BOARD_LEASES.entries()) {
    await createLease(lease, lease.ende !== undefined, boardLeaseId(index));
  }
  for (let index = 0; index < GENERATED_LEASE_COUNT; index++) {
    const lease = generatedLease(index);
    await createLease(lease, lease.terminated);
  }

  const maxId = boardLeaseId(MAX_NACHMIETER_INDEX);
  for (const party of [
    { name: "Max Nachmieter", rolle: "Hauptmieter" },
    { name: "Marie Nachmieter", rolle: "Mitmieterin" },
  ]) {
    const result = await partyExecutor.create({ lease: maxId, ...party }, TestUsers.admin, db);
    if (!result.isSuccess) throw new Error(`seed party "${party.name}" failed`);
  }
  const position = await positionExecutor.create(
    {
      lease: maxId,
      art: "Grundmiete",
      einheit: "WE-12",
      betrag: eur(850),
      gueltigVon: "2026-09-01",
    },
    TestUsers.admin,
    db,
  );
  if (!position.isSuccess) throw new Error("seed position failed");
};
