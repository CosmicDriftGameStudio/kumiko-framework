import { usePrimitives } from "@cosmicdrift/kumiko-renderer";
import { SidebarPanel } from "@cosmicdrift/kumiko-renderer-web";
import { type ReactNode, useState } from "react";
import { DemoPage, DemoSection } from "../components/page";

// Zweite Sidebar-Spalte (shadcn `sidebar-09`): eine Liste neben der
// Navigation, nicht im Content — der Screen-Content behaelt den Header ueber
// sich, die Liste reicht vom oberen bis zum unteren Fensterrand.
//
// Der Screen fuellt den Slot, die Shell haelt ihn. Ohne fuellenden Screen
// rendert die Shell nichts, deshalb kostet der Slot die uebrigen Screens
// nichts.

const MAILS = [
  {
    from: "Klempner Müller GmbH",
    subject: "Angebot Rohrbruch Goethestr. 12",
    teaser: "anbei unser Angebot für die Reparatur…",
    body: "anbei unser Angebot für die Reparatur der Steigleitung im Keller. Die Arbeiten dauern etwa zwei Tage, das Wasser muss dafür einen halben Tag abgestellt werden. Mit freundlichen Grüßen, Ralf Müller",
  },
  {
    from: "M. Gruber",
    subject: "Seit drei Tagen kein warmes Wasser",
    teaser: "seit Samstag habe ich in der ganzen Wohnung…",
    body: "Guten Tag, seit Samstag habe ich in der ganzen Wohnung kein warmes Wasser. Ich habe zweimal angerufen, niemand meldet sich zurück. Ich habe zwei kleine Kinder. Wenn bis morgen niemand kommt, mindere ich die Miete.",
  },
  {
    from: "Stadtwerke",
    subject: "Jahresabrechnung 2025",
    teaser: "Ihre Abrechnung steht zum Abruf bereit…",
    body: "Ihre Jahresabrechnung 2025 steht zum Abruf bereit. Der Betrag wird zum 15. des Folgemonats eingezogen.",
  },
  {
    from: "Hausmeisterservice Krause",
    subject: "Wartungstermin Heizung — Terminvorschlag",
    teaser: "wir schlagen Donnerstag 10 Uhr vor…",
    body: "wir schlagen Donnerstag 10 Uhr für die jährliche Wartung vor. Bitte kurz bestätigen.",
  },
  {
    from: "L. Weber",
    subject: "Nachsendeauftrag / neue Anschrift",
    teaser: "ab dem 1. bin ich unter folgender Adresse…",
    body: "ab dem 1. bin ich unter folgender Adresse erreichbar. Bitte die Nebenkostenabrechnung dorthin senden.",
  },
  {
    from: "Finanzamt Mitte",
    subject: "Grundsteuerbescheid 2026",
    teaser: "anbei der Bescheid für das Objekt…",
    body: "anbei der Bescheid für das Objekt Lindenstraße 14. Zahlbar bis zum Quartalsende.",
  },
  {
    from: "Elektro Sanders",
    subject: "Rechnung 2026-0148",
    teaser: "für die Arbeiten am Treppenhauslicht…",
    body: "für die Arbeiten am Treppenhauslicht stellen wir Ihnen 412,90 EUR in Rechnung.",
  },
  {
    from: "A. Petrov",
    subject: "Schlüssel verloren — Ersatz nötig",
    teaser: "ich habe leider meinen Wohnungsschlüssel…",
    body: "ich habe leider meinen Wohnungsschlüssel verloren. Wie bekomme ich einen Ersatz?",
  },
  {
    from: "Versicherung Nord",
    subject: "Police Gebäudeversicherung verlängert",
    teaser: "Ihre Police wurde um zwölf Monate…",
    body: "Ihre Police wurde um zwölf Monate verlängert. Die Beitragsrechnung folgt separat.",
  },
  {
    from: "Reinigung Bergmann",
    subject: "Angebot Treppenhausreinigung",
    teaser: "gerne unterbreiten wir Ihnen unser Angebot…",
    body: "gerne unterbreiten wir Ihnen unser Angebot für die wöchentliche Treppenhausreinigung.",
  },
  {
    from: "K. Duman",
    subject: "Lärm aus Wohnung 2a",
    teaser: "seit zwei Wochen ist es nachts sehr laut…",
    body: "seit zwei Wochen ist es nachts sehr laut. Können Sie bitte mit den Nachbarn sprechen?",
  },
  {
    from: "Schornsteinfeger Ott",
    subject: "Termin Feuerstättenschau",
    teaser: "die turnusmäßige Schau steht an…",
    body: "die turnusmäßige Feuerstättenschau steht an. Vorschlag: nächster Dienstag vormittags.",
  },
] as const;

// Exakt die Kopfzeile des ShellHeader (`h-16`, eingeklappt `h-12`) — sonst
// springt die Trennlinie zwischen Panel-Kopf und Content-Header.
const PANEL_HEADER =
  "flex h-16 shrink-0 items-center justify-between gap-2 border-sidebar-border border-b px-4 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12";

export function SidebarPanelDemo(): ReactNode {
  const { Text } = usePrimitives();
  const [selected, setSelected] = useState<string>(MAILS[0].subject);
  const active = MAILS.find((mail) => mail.subject === selected) ?? MAILS[0];

  return (
    <>
      <SidebarPanel storageKey="showcase:sidebar-panel-demo:width">
        <div className={PANEL_HEADER}>
          <span className="font-medium text-base">Posteingang</span>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {MAILS.map((mail) => (
            // kumiko-lint-ignore primitives-discipline multi-line clickable row (from/subject/teaser stacked) — the core Button primitive is a single-line inline control
            <button
              type="button"
              key={mail.subject}
              onClick={() => setSelected(mail.subject)}
              aria-current={mail.subject === selected}
              className="flex flex-col items-start gap-1 border-sidebar-border border-b p-4 text-left text-sm leading-tight last:border-b-0 hover:bg-sidebar-accent aria-[current=true]:bg-sidebar-accent aria-[current=true]:text-sidebar-accent-foreground"
            >
              <span className="w-full truncate">{mail.from}</span>
              <span className="line-clamp-2 w-full font-medium">{mail.subject}</span>
              <span className="line-clamp-2 w-full text-muted-foreground text-xs">
                {mail.teaser}
              </span>
            </button>
          ))}
        </div>
      </SidebarPanel>
      <DemoPage title={active.subject} description={`Von ${active.from}`}>
        <DemoSection title="Nachricht">
          <Text>{active.body}</Text>
        </DemoSection>
        <DemoSection title="Wofür der Slot da ist">
          <Text>
            Mail-Client-Layout: die Liste steht neben der Navigation und reicht über die volle
            Fensterhöhe, der Lesebereich behält den Header über sich. Ein Screen kann das von sich
            aus nicht — er rendert unter dem Header. Der Slot dreht die Richtung um.
          </Text>
        </DemoSection>
        <DemoSection title="Ohne Shell">
          <Text variant="small">
            Bietet die Shell keinen Slot (Public-Surface, Tests), rendern die Kinder an Ort und
            Stelle statt zu verschwinden.
          </Text>
        </DemoSection>
      </DemoPage>
    </>
  );
}
