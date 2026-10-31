// Inbox reader building blocks with a rent-management case: tenant reports a cold
// heating system, the property manager answers, the AI proposes follow-up steps.

import { useTranslation } from "@cosmicdrift/kumiko-renderer";
import {
  AiSurface,
  MessageReader,
  PdfPreview,
  SectionCard,
  StepList,
  type StepListItem,
  type ThreadMessage,
} from "@cosmicdrift/kumiko-renderer/web";
import { type ReactNode, useMemo, useState } from "react";
import { buildSamplePdfBase64 } from "./sample-pdf";

const HEATING_THREAD: readonly ThreadMessage[] = [
  {
    id: "tenant-first",
    author: "Anna Schneider",
    address: "a.schneider@mieter.test",
    direction: "incoming",
    timeLabel: "Mo 08:14",
    body: {
      kind: "text",
      text: "Guten Morgen,\nseit gestern Abend ist meine Heizung komplett kalt. Können Sie jemanden schicken?",
    },
  },
  {
    id: "manager-reply",
    author: "Du",
    direction: "outgoing",
    timeLabel: "Mo 09:02",
    body: {
      kind: "text",
      text: "Der Monteur kommt am Dienstag zwischen 8 und 10 Uhr. Bitte sorgen Sie für Zugang zur Wohnung.",
    },
  },
  {
    id: "tenant-second",
    author: "Anna Schneider",
    address: "a.schneider@mieter.test",
    direction: "incoming",
    timeLabel: "Heute 09:41",
    body: {
      kind: "text",
      text: [
        "Guten Tag,",
        "der Monteur ist am Dienstag nicht gekommen, ich habe den ganzen Vormittag gewartet. Die Heizung ist weiter kalt, im Kinderzimmer sind es 15 Grad.",
        "Ich erwarte heute einen neuen Termin. Ab sofort mindere ich die Miete um 20 Prozent, bis die Heizung wieder läuft.",
        "",
        "Am Mo., 9:02 schrieb Du <verwaltung@hausverwaltung.test>:",
        "> Der Monteur kommt am Dienstag zwischen 8 und 10 Uhr.",
        "> Bitte sorgen Sie für Zugang zur Wohnung.",
      ].join("\n"),
    },
    attachments: [
      {
        id: "thermometer",
        name: "thermometer-kinderzimmer.jpg",
        meta: "Foto, 1,2 MB",
        kind: "image",
        onOpen: () => {},
      },
      {
        id: "contract",
        name: "Mietvertrag-Goethestr-12.pdf",
        meta: "PDF, 2 Seiten",
        kind: "pdf",
        onOpen: () => {},
      },
    ],
  },
];

const HEATING_PLAN: readonly StepListItem[] = [
  {
    id: "case",
    title: "Vorgang „Heizungsausfall Whg. 3“",
    status: "done",
    meta: "Angelegt von dir, Mo 09:05",
    link: { label: "Öffnen", href: "#vorgang" },
  },
  {
    id: "order",
    title: "Neuer Auftrag an Heizung Schulz GmbH",
    description: "Notdienst heute, Zugang über Hausmeister. Der alte Auftrag wird storniert.",
    status: "open",
    tags: [{ label: "Sendet eine Mail", tone: "accent" }],
    actions: [
      { id: "review", label: "Prüfen", variant: "primary", onClick: () => {} },
      { id: "reject", label: "Ablehnen", variant: "ghost", onClick: () => {} },
    ],
  },
  {
    id: "reply",
    title: "Antwort an Anna Schneider",
    description: "Neuer Termin, Minderung erst nach Prüfung des Mangels.",
    status: "locked",
    lockedReason: "Auftrag",
    tags: [{ label: "Sendet eine Mail", tone: "accent" }],
  },
];

export function InboxReaderExamples(): ReactNode {
  const t = useTranslation();
  const [activeTabId, setActiveTabId] = useState("mail");
  const contractPdf = useMemo(
    () => buildSamplePdfBase64(["Mietvertrag Goethestrasse 12, Whg. 3", "Heizung und Nebenkosten"]),
    [],
  );
  return (
    <SectionCard
      title={t("widgets:catalog:inbox-reader")}
      subtitle={t("widgets:catalog:inbox-reader-subtitle")}
    >
      <div className="grid gap-4 lg:grid-cols-[1fr_340px]" data-testid="inbox-reader-demo">
        <MessageReader
          thread={{ messages: HEATING_THREAD }}
          activeTabId={activeTabId}
          onTabChange={setActiveTabId}
          attachmentTabs={[
            {
              id: "contract",
              label: "Anhang 1: Mietvertrag-Goethestr-12.pdf",
              render: () => (
                <div className="h-[560px]">
                  <PdfPreview
                    variant="viewer"
                    source={{ base64: contractPdf }}
                    searchTerm="Heizung"
                    testId="inbox-reader-pdf"
                  />
                </div>
              ),
            },
          ]}
        />
        <div className="flex flex-col gap-4">
          <AiSurface title="Einordnung der KI" label="Einordnung der KI">
            <p className="m-0 text-sm leading-normal">
              Die Heizung ist seit Montag kalt. Der vereinbarte Monteur ist nicht gekommen. Frau
              Schneider kündigt eine Mietminderung an und will heute einen neuen Termin.
            </p>
          </AiSurface>
          <StepList
            title={t("widgets:catalog:inbox-plan-title")}
            steps={HEATING_PLAN}
            footerActions={[
              { id: "reject-all", label: "Alle ablehnen", variant: "ghost", onClick: () => {} },
              { id: "next", label: "Nächsten prüfen", variant: "primary", onClick: () => {} },
            ]}
          />
        </div>
      </div>
    </SectionCard>
  );
}
