// A mail-inbox layout as solon builds it: a 400px list pane whose tab strip
// carries counts, next to a wide record-style strip, under a shell header with
// a title and a status. narrow-header-tabs.spec.ts measures both in Chromium.

import type { ReactNode } from "react";
import { DefaultPageHeader } from "../../src/web/primitives/page-header";
import { DefaultTabs } from "../../src/web/primitives/tabs";

const INBOX_TABS = [
  { id: "open", label: "Offen", count: 6 },
  { id: "done", label: "Erledigt", count: 128 },
  { id: "ignored", label: "Ignoriert", count: 12 },
  { id: "trash", label: "Archiv", count: 3 },
];

const RECORD_TABS = [
  { id: "overview", label: "Übersicht" },
  { id: "contracts", label: "Verträge", count: 2 },
  { id: "documents", label: "Dokumente", count: 14 },
  { id: "history", label: "Verlauf" },
];

export function InboxPaneScreen(): ReactNode {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "2rem", padding: "1rem" }}>
      <DefaultPageHeader
        title="Posteingang"
        status={<span data-testid="inbox-status">6 offen</span>}
      />
      <div
        data-testid="inbox-pane"
        style={{ width: 400, maxWidth: "100%", border: "1px solid #ddd" }}
      >
        <DefaultTabs items={INBOX_TABS} activeId="open" onSelect={() => {}} testId="inbox-tabs" />
      </div>
      <div
        data-testid="record-pane"
        style={{ width: 900, maxWidth: "100%", border: "1px solid #ddd" }}
      >
        <DefaultTabs
          items={RECORD_TABS}
          activeId="overview"
          onSelect={() => {}}
          testId="record-tabs"
        />
      </div>
    </div>
  );
}
