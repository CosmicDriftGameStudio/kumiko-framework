import type { SeedFn } from "@cosmicdrift/kumiko-dev-server";
import { TestUsers } from "@cosmicdrift/kumiko-framework/stack";
import { countRowsForTenant } from "../db/queries/row-counts";

const OCTAVIA_DESCRIPTION = [
  "One owner from new. Full Škoda main dealer service history.",
  "2.0 TDI, 110 kW, automatic, diesel. 28,500 km.",
  "No accidents. Small stone chip on the front bumper, see photos.",
  "Two keys. 12 months warranty.",
].join("\n");

const OCTAVIA = {
  fin: "TMBJG7NE5M0123456",
  marke: "Škoda",
  modell: "Octavia",
  baujahr: 2021,
  preis: { amount: 18450, currency: "EUR" },
  kilometerstand: 28500,
  kilometerEinheit: "km",
  kraftstoffart: "diesel",
  getriebe: "automatic",
  leistungKw: 110,
  karosserieform: "estate",
  ausstattungslinie: "SE L",
  zustand: "used",
  vorbesitzer: 1,
  garantieMonate: 12,
  garantieJahre: "3",
  inspektion: "12",
  scheckheft: "complete",
  scheckheftGepflegt: true,
  nichtraucher: true,
  beschreibung: OCTAVIA_DESCRIPTION,
  ausstattung: "Klimaautomatik, Navigation, Sitzheizung, Anhängerkupplung",
} as const;

const GOLF = {
  fin: "WVWZZZ1KZAW123456",
  marke: "VW",
  modell: "Golf",
  baujahr: 2019,
  preis: { amount: 14900, currency: "EUR" },
  kilometerstand: 64200,
  kilometerEinheit: "km",
  kraftstoffart: "petrol",
  getriebe: "manual",
  zustand: "used",
  garantieJahre: "1",
  inspektion: "",
  scheckheftGepflegt: false,
} as const;

type SeedPost = {
  readonly datum: string;
  readonly kanal: "Instagram" | "Facebook" | "mobile.de";
  readonly text: string;
  readonly status: "geplant" | "gepostet";
};

type SeedCampaign = {
  readonly name: string;
  readonly status: "aktiv" | "abgeschlossen" | "entwurf";
  readonly meta: string;
  readonly gestartetAm: string;
  readonly posts: readonly SeedPost[];
};

const CAMPAIGNS: readonly SeedCampaign[] = [
  {
    name: "Škoda Octavia (2021)",
    status: "aktiv",
    meta: "Tag 1 von 30 · 4 Besuche · 1 Interessent",
    gestartetAm: "2026-09-29",
    posts: [
      { datum: "2026-09-29", kanal: "mobile.de", text: "Inserat online", status: "gepostet" },
      {
        datum: "2026-10-02",
        kanal: "Instagram",
        text: "Fotostrecke Außenansicht",
        status: "geplant",
      },
      { datum: "2026-10-06", kanal: "Facebook", text: "Probefahrt-Aktion", status: "geplant" },
      { datum: "2026-10-12", kanal: "Instagram", text: "Reel: Innenraum", status: "geplant" },
    ],
  },
  {
    name: "VW Golf (2019)",
    status: "aktiv",
    meta: "Tag 12 von 30 · 86 Besuche · 5 Interessenten",
    gestartetAm: "2026-09-18",
    posts: [
      { datum: "2026-09-18", kanal: "mobile.de", text: "Inserat online", status: "gepostet" },
      { datum: "2026-09-21", kanal: "Instagram", text: "Fotostrecke", status: "gepostet" },
      { datum: "2026-09-25", kanal: "Facebook", text: "Preis gesenkt", status: "gepostet" },
      { datum: "2026-10-03", kanal: "Instagram", text: "Story: Probefahrt", status: "geplant" },
      { datum: "2026-10-08", kanal: "Facebook", text: "Erinnerung", status: "geplant" },
      { datum: "2026-10-15", kanal: "mobile.de", text: "Inserat auffrischen", status: "geplant" },
    ],
  },
  {
    name: "BMW 320d Touring (2020)",
    status: "abgeschlossen",
    meta: "30 Tage · 212 Besuche · 9 Interessenten",
    gestartetAm: "2026-08-30",
    posts: [
      { datum: "2026-08-30", kanal: "mobile.de", text: "Inserat online", status: "gepostet" },
      { datum: "2026-09-05", kanal: "Instagram", text: "Fotostrecke", status: "gepostet" },
      { datum: "2026-09-20", kanal: "Facebook", text: "Letzte Chance", status: "gepostet" },
    ],
  },
  {
    name: "Ford Focus (2018)",
    status: "entwurf",
    meta: "Noch nicht gestartet",
    gestartetAm: "2026-08-01",
    posts: [
      { datum: "2026-10-20", kanal: "mobile.de", text: "Inserat online", status: "geplant" },
      { datum: "2026-10-22", kanal: "Instagram", text: "Fotostrecke", status: "geplant" },
      { datum: "2026-10-27", kanal: "Facebook", text: "Vorstellung", status: "geplant" },
    ],
  },
  {
    name: "Herbst - Gebrauchtwagen",
    status: "entwurf",
    meta: "Geplant für Oktober",
    gestartetAm: "2026-07-15",
    posts: [
      {
        datum: "2026-10-05",
        kanal: "Facebook",
        text: "Ankündigung Herbstaktion",
        status: "geplant",
      },
      { datum: "2026-10-10", kanal: "Instagram", text: "Highlights der Woche", status: "geplant" },
      { datum: "2026-10-18", kanal: "mobile.de", text: "Sammelinserat", status: "geplant" },
    ],
  },
];

export const seedVehicles: SeedFn = async (stack) => {
  const { tenantId } = TestUsers.admin;
  if ((await countRowsForTenant(stack.db, "read_ui_walkthrough_vehicles", tenantId)) > 0) return;
  await stack.http.writeOk("vehicles:write:vehicle:create", OCTAVIA, TestUsers.admin);
  await stack.http.writeOk("vehicles:write:vehicle:create", GOLF, TestUsers.admin);
  for (const { posts, ...campaign } of CAMPAIGNS) {
    const gepostet = posts.filter((post) => post.status === "gepostet").length;
    const { id } = await stack.http.writeOk<{ id: string }>(
      "vehicles:write:campaign:create",
      { ...campaign, gepostet },
      TestUsers.admin,
    );
    for (const post of posts) {
      await stack.http.writeOk(
        "vehicles:write:campaign-post:create",
        { ...post, campaign: id },
        TestUsers.admin,
      );
    }
  }
};
