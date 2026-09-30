import type { SeedFn } from "@cosmicdrift/kumiko-dev-server";
import { TestUsers } from "@cosmicdrift/kumiko-framework/stack";
import { countRowsForTenant } from "../db/queries/row-counts";

const OCTAVIA_DESCRIPTION = [
  "One owner from new. Full Škoda main dealer service history.",
  "2.0 TDI, 110 kW, automatic, diesel. 28,000 miles.",
  "No accidents. Small stone chip on the front bumper, see photos.",
  "Two keys. 12 months warranty.",
].join("\n");

const OCTAVIA = {
  fin: "TMBJG7NE5M0123456",
  marke: "Škoda",
  modell: "Octavia",
  baujahr: 2021,
  preis: { amount: 18450, currency: "EUR" },
  kilometerstand: 28000,
  kilometerEinheit: "mi",
  kraftstoffart: "diesel",
  getriebe: "automatic",
  leistungKw: 110,
  karosserieform: "estate",
  ausstattungslinie: "SE L",
  zustand: "used",
  vorbesitzer: 1,
  garantieMonate: 12,
  scheckheft: "complete",
  beschreibung: OCTAVIA_DESCRIPTION,
  ausstattung: "Klimaautomatik, Navigation, Sitzheizung, Anhängerkupplung",
} as const;

const CAMPAIGNS = [
  {
    name: "Škoda Octavia (2021)",
    status: "aktiv",
    meta: "Tag 1 von 30 · 4 Besuche · 1 Interessent",
  },
  { name: "VW Golf (2019)", status: "aktiv", meta: "Tag 12 von 30 · 86 Besuche · 5 Interessenten" },
  {
    name: "BMW 320d Touring (2020)",
    status: "abgeschlossen",
    meta: "30 Tage · 212 Besuche · 9 Interessenten",
  },
  { name: "Ford Focus (2018)", status: "entwurf", meta: "Noch nicht gestartet" },
] as const;

export const seedVehicles: SeedFn = async (stack) => {
  const { tenantId } = TestUsers.admin;
  if ((await countRowsForTenant(stack.db, "read_ui_walkthrough_vehicles", tenantId)) > 0) return;
  await stack.http.writeOk("vehicles:write:vehicle:create", OCTAVIA, TestUsers.admin);
  for (const campaign of CAMPAIGNS) {
    await stack.http.writeOk("vehicles:write:campaign:create", campaign, TestUsers.admin);
  }
};
