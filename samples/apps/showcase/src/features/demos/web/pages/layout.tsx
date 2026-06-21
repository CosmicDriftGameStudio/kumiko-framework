// Layout-Demo: Slot-Visualisierung. Pro Primitive ein Mini-Diagramm
// der Boxen + Slot-Namen drin, plus ein Code-Snippet darunter das
// zeigt wie der Slot aus dem Caller heraus angesprochen wird.
//
// Die Skizzen sind absichtlich Sample-Code mit raw <div> + Tailwind —
// hier geht's um ein Bild, nicht um die Primitives selbst zu zeigen.

import type { ReactNode } from "react";
import { DemoPage, DemoSection } from "../components/page";

function CodeBlock({ children }: { readonly children: string }): ReactNode {
  return (
    <pre className="text-xs bg-muted/30 border rounded-md p-3 overflow-x-auto font-mono whitespace-pre">
      {children}
    </pre>
  );
}

// Slot-Box: kleine Markup-Insel mit Slot-Name + optional Beschreibung.
// `tone` steuert die Hintergrundfarbe damit man pro Diagramm-Bereich
// (Sidebar vs Main vs Action-Bar) Farb-Distinction sieht.
function Slot({
  name,
  hint,
  tone = "default",
  className,
}: {
  readonly name: string;
  readonly hint?: string;
  readonly tone?: "default" | "muted" | "actionBar";
  readonly className?: string;
}): ReactNode {
  const toneClass =
    tone === "muted" ? "bg-muted/40" : tone === "actionBar" ? "bg-muted/30" : "bg-card"; // kumiko-lint-ignore primitives-discipline layout-tone helper (Default-Tone, kein Card-Panel)
  return (
    <div
      className={`flex flex-col items-start justify-center px-3 py-2 ${toneClass} ${className ?? ""}`}
    >
      <code className="text-[11px] font-mono font-semibold text-foreground">{name}</code>
      {hint !== undefined && (
        <span className="text-[10px] text-muted-foreground mt-0.5">{hint}</span>
      )}
    </div>
  );
}

function ShellSketch(): ReactNode {
  return (
    <div className="rounded-md border overflow-hidden grid grid-cols-[180px_1fr] h-80">
      <div className="border-r bg-muted/40 flex flex-col">
        <Slot
          name="brand"
          hint="Header"
          tone="muted"
          className="border-b border-border/50 h-12 justify-center"
        />
        <Slot
          name="sidebarActions"
          hint="Icon-Row"
          tone="muted"
          className="border-b border-border/50"
        />
        <div className="flex-1 p-3 flex flex-col items-start justify-start">
          <code className="text-[11px] font-mono font-semibold">{"<NavTree />"}</code>
          <span className="text-[10px] text-muted-foreground mt-0.5">
            children — auto aus schema.navs
          </span>
        </div>
        <Slot name="sidebarFooter" hint="Bottom" tone="muted" className="border-t" />
      </div>
      <div className="flex flex-col">
        <div className="h-12 border-b bg-muted/30 flex items-center justify-between px-4">
          <code className="text-[11px] font-mono font-semibold">Form.title / toolbarTitle</code>
          <code className="text-[11px] font-mono font-semibold">Form.actions / toolbarEnd →</code>
        </div>
        <div className="flex-1 p-4 flex flex-col items-start justify-start gap-1">
          <code className="text-[11px] font-mono font-semibold">{"{children}"}</code>
          <span className="text-[10px] text-muted-foreground">
            Form.children / DataTable / Custom-Screen
          </span>
        </div>
      </div>
    </div>
  );
}

function FormSketch(): ReactNode {
  return (
    <div className="rounded-md border overflow-hidden">
      <div className="h-10 border-b bg-muted/30 flex items-center justify-between px-4">
        <code className="text-[11px] font-mono font-semibold">title</code>
        <code className="text-[11px] font-mono font-semibold">actions →</code>
      </div>
      <div className="p-4 flex flex-col items-start gap-1">
        <code className="text-[11px] font-mono font-semibold">{"{children}"}</code>
        <span className="text-[10px] text-muted-foreground">
          Sections + Fields (RenderEdit baut das aus screen.layout.sections)
        </span>
      </div>
    </div>
  );
}

function DataTableSketch(): ReactNode {
  return (
    <div className="rounded-md border overflow-hidden">
      <div className="h-10 border-b bg-muted/30 flex items-center px-4 gap-3">
        <code className="text-[11px] font-mono font-semibold">toolbarTitle</code>
        <code className="text-[11px] font-mono font-semibold flex-1 text-center">toolbarStart</code>
        <code className="text-[11px] font-mono font-semibold">toolbarEnd →</code>
      </div>
      <div className="p-4 flex flex-col items-start gap-1">
        <code className="text-[11px] font-mono font-semibold">rows / emptyState</code>
        <span className="text-[10px] text-muted-foreground">
          rows.length === 0 → emptyState (sonst Tabelle)
        </span>
      </div>
    </div>
  );
}

function MiscSketches(): ReactNode {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <div className="rounded-md border p-3 flex flex-col gap-2">
        <code className="text-[11px] font-mono font-semibold">{"<Section title>"}</code>
        <div className="rounded border p-2 bg-muted/30">
          <code className="text-[10px] font-mono">title</code>
        </div>
        <div className="rounded border p-2">
          <code className="text-[10px] font-mono">{"{children}"}</code>
        </div>
      </div>
      <div className="rounded-md border p-3 flex flex-col gap-2">
        <code className="text-[11px] font-mono font-semibold">{"<Banner>"}</code>
        <div className="rounded border p-2 flex justify-between gap-2">
          <code className="text-[10px] font-mono">{"{children}"}</code>
          <code className="text-[10px] font-mono">actions →</code>
        </div>
        <span className="text-[10px] text-muted-foreground">+ padded für Page-State</span>
      </div>
      <div className="rounded-md border p-3 flex flex-col gap-2">
        <code className="text-[11px] font-mono font-semibold">{"<Heading variant>"}</code>
        <div className="flex flex-col gap-1">
          <code className="text-[10px] font-mono">page → h1, text-2xl</code>
          <code className="text-[10px] font-mono">section → h2, uppercase</code>
        </div>
      </div>
    </div>
  );
}

export function LayoutDemo(): ReactNode {
  return (
    <DemoPage
      title="Layout"
      description="Wo landet welcher Slot? Pro Primitive ein Mini-Diagramm + der dazugehörige JSX-Aufruf."
    >
      <DemoSection title="App-Shell — DefaultAppShell">
        <ShellSketch />
        <CodeBlock>{`<DefaultAppShell
  brand={<WorkspaceBrand />}              // Sidebar-Header
  schema={schema}                         // baut den NavTree
  sidebarActions={<IconRow />}            // Search / Theme / Tenant
  sidebarFooter={<Profile />}             // Bottom-Slot
>
  {children}                              // Main-Content
</DefaultAppShell>`}</CodeBlock>
      </DemoSection>

      <DemoSection title="Form — DefaultForm / RenderEdit">
        <FormSketch />
        <CodeBlock>{`<Form
  onSubmit={handleSubmit}
  title="Eintrag bearbeiten"            // Top-Bar links (sticky)
  actions={<><Cancel/><Save/></>}        // Top-Bar rechts (sticky)
>
  <Section title="Basics">
    <Field id="title" label="Titel">
      <Input kind="text" ... />
    </Field>
  </Section>
</Form>`}</CodeBlock>
      </DemoSection>

      <DemoSection title="DataTable / RenderList">
        <DataTableSketch />
        <CodeBlock>{`<DataTable
  columns={cols}
  rows={rows}
  toolbarTitle="Items"                    // Toolbar links
  toolbarStart={<SearchInput />}          // Toolbar mittig (flex-1)
  toolbarEnd={<NewButton />}              // Toolbar rechts (ml-auto)
  emptyState={<EmptyHint />}              // wenn rows.length === 0
/>`}</CodeBlock>
      </DemoSection>

      <DemoSection title="Section / Banner / Heading">
        <MiscSketches />
      </DemoSection>
    </DemoPage>
  );
}
