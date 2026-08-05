// Visual catalog of the widget kit — every section shows one widget with
// static data. Also serves as the e2e render surface (content.spec).

import { useLocale, usePrimitives, useTranslation } from "@cosmicdrift/kumiko-renderer";
import {
  AiTextArea,
  AiTextField,
  BooleanField,
  CollapsibleSection,
  ComparisonTable,
  DateField,
  DetailList,
  Drawer,
  EmptyState,
  InfinityList,
  MiniStat,
  ModeSwitch,
  MoneyField,
  PercentField,
  ProgressBar,
  RangeField,
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  ResultPanel,
  ResultTable,
  SectionCard,
  SelectField,
  StatCard,
  StatusBadge,
  StatusBarChart,
  TextareaField,
  TextField,
  TimeseriesChart,
  useDraft,
} from "@cosmicdrift/kumiko-renderer-web";
import { Wallet } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { euro, percent } from "../lib/format";

const RESPONSE_TIMES = Array.from({ length: 48 }, (_, i) => ({
  atMs: i * 30 * 60 * 1000,
  value: i === 20 ? null : 120 + Math.round(80 * Math.abs(Math.sin(i / 5))),
}));

export function Widgets(): ReactNode {
  const t = useTranslation();
  const locale = useLocale().locale();
  const [mode, setMode] = useState<"annuity" | "fixed">("annuity");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { Button } = usePrimitives();

  const uptime = useMemo(
    () =>
      Array.from({ length: 90 }, (_, i) => ({
        key: `day-${i}`,
        level: i === 30 ? 0.25 : i % 17 === 0 ? 0.75 : 1,
        tone: i === 30 ? ("critical" as const) : i % 17 === 0 ? ("warn" as const) : ("ok" as const),
        label: t("widgets:catalog:uptime-day", { n: i + 1 }),
      })),
    [t],
  );

  return (
    <div className="flex flex-col gap-6 p-6" data-testid="widgets-page">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={<Wallet className="size-4" aria-hidden="true" />}
          label={t("widgets:catalog:portfolio")}
          value={euro(92753, locale)}
          sub={t("widgets:catalog:portfolio-sub")}
          delta={{ value: percent(2.1, locale), direction: "up", tone: "positive" }}
          spark={[3, 5, 4, 7, 6, 9, 11, 10]}
        />
        <StatCard
          label={t("widgets:catalog:remaining-debt")}
          value={euro(184000, locale)}
          tone="warn"
          trend={t("widgets:catalog:remaining-debt-trend")}
        />
        <MiniStat label={t("widgets:catalog:interest-rate")} value={percent(3.1, locale)} />
        <MiniStat label={t("widgets:catalog:rate")} value="890 €" tone="positive" emphasize />
      </div>

      <SectionCard
        title={t("widgets:catalog:uptime")}
        subtitle={t("widgets:catalog:uptime-subtitle")}
        action={<StatusBadge tone="ok">{t("widgets:catalog:operational")}</StatusBadge>}
      >
        <StatusBarChart
          ariaLabel={t("widgets:catalog:uptime-aria")}
          entries={uptime}
          startLabel={t("widgets:catalog:uptime-start")}
          endLabel={t("widgets:catalog:uptime-end")}
        />
      </SectionCard>

      <SectionCard
        title={t("widgets:catalog:response-time")}
        subtitle={t("widgets:catalog:response-time-subtitle")}
      >
        <TimeseriesChart
          points={RESPONSE_TIMES}
          windowStartMs={0}
          windowEndMs={24 * 60 * 60 * 1000}
          ariaLabel={t("widgets:catalog:response-time-aria")}
          axisLabels={{
            start: t("widgets:catalog:24h-ago"),
            mid: t("widgets:catalog:12h-ago"),
            end: t("widgets:catalog:now"),
          }}
        />
      </SectionCard>

      <SectionCard
        title={t("widgets:catalog:status-tones")}
        action={<ProgressBar value={0.65} className="w-40" />}
      >
        <div className="flex flex-wrap gap-2">
          <StatusBadge tone="ok">{t("widgets:catalog:status-operational")}</StatusBadge>
          <StatusBadge tone="warn">{t("widgets:catalog:status-degraded")}</StatusBadge>
          <StatusBadge tone="bad">{t("widgets:catalog:status-partial-outage")}</StatusBadge>
          <StatusBadge tone="critical">{t("widgets:catalog:status-major-outage")}</StatusBadge>
          <StatusBadge tone="muted">{t("widgets:catalog:status-maintenance")}</StatusBadge>
        </div>
      </SectionCard>

      <SectionCard
        title={t("widgets:catalog:repayment-model")}
        action={
          <ModeSwitch
            value={mode}
            onChange={setMode}
            options={[
              { value: "annuity", label: t("widgets:catalog:mode-annuity") },
              { value: "fixed", label: t("widgets:catalog:mode-fixed") },
            ]}
          />
        }
      >
        <DetailList
          rows={[
            {
              label: t("widgets:catalog:model"),
              value:
                mode === "annuity"
                  ? t("widgets:catalog:mode-annuity")
                  : t("widgets:catalog:mode-fixed"),
            },
            { label: t("widgets:catalog:nominal-rate"), value: percent(3.1, locale) },
            {
              label: t("widgets:catalog:status"),
              value: <StatusBadge tone="ok">{t("widgets:catalog:active")}</StatusBadge>,
            },
          ]}
        />
      </SectionCard>

      <CollapsibleSection title={t("widgets:catalog:advanced-settings")}>
        <EmptyState
          title={t("widgets:catalog:no-extra-repayments-title")}
          description={t("widgets:catalog:no-extra-repayments-description")}
        />
      </CollapsibleSection>

      <SectionCard
        title={t("widgets:catalog:drawer")}
        action={<Button onClick={() => setDrawerOpen(true)}>{t("widgets:catalog:open")}</Button>}
      >
        <DetailList
          rows={[
            {
              label: t("widgets:catalog:status"),
              value: drawerOpen
                ? t("widgets:catalog:open-status")
                : t("widgets:catalog:closed-status"),
            },
          ]}
        />
      </SectionCard>
      <Drawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        title={t("widgets:catalog:drawer-message-title")}
        description="William Smith · 09:34"
        footer={<Button onClick={() => setDrawerOpen(false)}>{t("widgets:catalog:close")}</Button>}
        testId="drawer-demo"
      >
        <p className="text-sm">Hi team, just a reminder about our meeting tomorrow at 10 AM.</p>
      </Drawer>

      <InboxDemo />
      <FinancingCalculatorDemo />
      <FormFieldsDemo />
      <ComparisonDemo />
      <AiTextDemo />
    </div>
  );
}

type InboxMessage = {
  readonly id: string;
  readonly sender: string;
  readonly subject: string;
  readonly snippet: string;
  readonly unread: boolean;
};
type InboxPage = { readonly rows: readonly InboxMessage[]; readonly nextCursor: string | null };

// Inbox-like scroll list: filter (unread toggle + search) + row action
// (archive, no-op like the other demo buttons here). Clicking a row shows
// the message in the right panel — split via resizable, like the list/read
// pair in real mail clients (a draggable handle instead of an OS resize
// grip).
function InboxDemo(): ReactNode {
  const t = useTranslation();
  const { Button } = usePrimitives();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [search, setSearch] = useState("");
  // Debounced: InfinityList refetches whenever its payload identity changes
  // (payloadKey = JSON.stringify(payload)), so wiring `search` directly in
  // would refetch on every keystroke — a loading flash per character.
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(id);
  }, [search]);
  const [selected, setSelected] = useState<InboxMessage | null>(null);
  return (
    <SectionCard
      title={t("widgets:catalog:inbox")}
      action={
        <div className="flex items-center gap-2">
          <ModeSwitch
            value={unreadOnly ? "unread" : "all"}
            onChange={(v) => setUnreadOnly(v === "unread")}
            options={[
              { value: "all", label: t("widgets:catalog:filter-all") },
              { value: "unread", label: t("widgets:catalog:filter-unread") },
            ]}
          />
          <Button variant="secondary" onClick={() => {}}>
            {t("widgets:catalog:mark-all-read")}
          </Button>
        </div>
      }
    >
      <TextField
        label={t("widgets:catalog:search")}
        id="inbox-search"
        name="inbox-search"
        value={search}
        onChange={setSearch}
        placeholder={t("widgets:catalog:search-placeholder")}
      />
      <ResizablePanelGroup orientation="horizontal" className="mt-3 h-96 rounded-lg border">
        <ResizablePanel defaultSize="35" minSize="25" className="overflow-y-auto">
          <InfinityList<InboxPage, InboxMessage>
            query="widgets:query:metrics:inbox-messages"
            payload={{ unreadOnly, search: debouncedSearch }}
            pageSize={6}
            rows={(data) => data.rows}
            nextCursor={(data) => data.nextCursor}
            rowId={(row) => row.id}
            testId="inbox-demo"
            renderRow={(row) => (
              <div
                className={`flex items-start justify-between gap-4 border-b px-3 py-2 last:border-b-0 hover:bg-muted/50 ${
                  selected?.id === row.id ? "bg-muted" : ""
                }`}
              >
                <button
                  type="button"
                  onClick={() => setSelected(row)}
                  className="min-w-0 flex-1 text-left"
                >
                  <div className={row.unread ? "font-semibold" : ""}>
                    {row.sender} · {row.subject}
                  </div>
                  <div className="truncate text-sm text-muted-foreground">{row.snippet}</div>
                </button>
                <Button variant="secondary" size="sm" onClick={() => {}}>
                  {t("widgets:catalog:archive")}
                </Button>
              </div>
            )}
          />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize="65" minSize="30" className="overflow-y-auto p-4">
          {selected === null ? (
            <EmptyState
              title={t("widgets:catalog:no-message-selected-title")}
              description={t("widgets:catalog:no-message-selected-description")}
            />
          ) : (
            <div>
              <div className="font-semibold">{selected.sender}</div>
              <div className="text-sm text-muted-foreground">{selected.subject}</div>
              <p className="mt-4 text-sm">{selected.snippet}</p>
            </div>
          )}
        </ResizablePanel>
      </ResizablePanelGroup>
    </SectionCard>
  );
}

// Ghost-text completion + correct/translate/rewrite toolbar. The server
// handler here is a hand-rolled demo feature (ai-text-demo.ts, canned
// strings), not the real enterprise feature — kumiko-framework must not
// import kumiko-enterprise. The title field is deliberately pre-filled with
// a value wider than the box (ghost-overlay scroll sync), the note textarea
// with more lines than visible (vertical scroll sync).
function AiTextDemo(): ReactNode {
  const t = useTranslation();
  const [title, setTitle] = useState(() => t("widgets:catalog:long-title-demo"));
  const [note, setNote] = useState(() =>
    Array.from({ length: 12 }, (_, i) => t("widgets:catalog:long-note-line", { n: i + 1 })).join(
      "\n",
    ),
  );
  return (
    <SectionCard
      title={t("widgets:catalog:ai-text")}
      subtitle={t("widgets:catalog:ai-text-subtitle")}
    >
      <AiTextField
        id="ai-text-title"
        name="title"
        label={t("widgets:catalog:title")}
        value={title}
        onChange={setTitle}
      />
      <AiTextArea
        id="ai-text-note"
        name="note"
        label={t("widgets:catalog:note")}
        value={note}
        onChange={setNote}
        rows={4}
      />
    </SectionCard>
  );
}

// Field widgets for non-number types (select/date/text/boolean/textarea) —
// wrap the same usePrimitives input kinds as NumberField.
interface FieldsDraft {
  readonly land: string;
  readonly datum: string;
  readonly name: string;
  readonly aktiv: boolean;
  readonly notiz: string;
  readonly abruf: number;
}

const FIELDS_DEFAULTS: FieldsDraft = {
  land: "NW",
  datum: "2026-07-10",
  name: "",
  aktiv: true,
  notiz: "",
  abruf: 40,
};

function FormFieldsDemo(): ReactNode {
  const t = useTranslation();
  const { draft, field } = useDraft<FieldsDraft>(FIELDS_DEFAULTS);
  const { Button } = usePrimitives();
  return (
    <SectionCard title={t("widgets:catalog:form-fields")}>
      <TextField
        label={t("widgets:catalog:name")}
        {...field("name")}
        placeholder={t("widgets:catalog:name-placeholder")}
      />
      <SelectField
        label={t("widgets:catalog:state")}
        {...field("land")}
        options={[
          { value: "NW", label: t("widgets:catalog:state-nw") },
          { value: "BY", label: t("widgets:catalog:state-by") },
        ]}
      />
      <DateField label={t("widgets:catalog:date")} {...field("datum")} />
      <BooleanField label={t("widgets:catalog:include-broker")} {...field("aktiv")} />
      <RangeField
        label={t("widgets:catalog:call-rate", { n: draft.abruf })}
        {...field("abruf")}
        min={0}
        max={100}
        step={5}
      />
      <TextareaField label={t("widgets:catalog:note")} {...field("notiz")} rows={3} />
      <div className="flex items-center gap-2">
        <Button size="sm" variant="secondary" onClick={() => {}}>
          {t("widgets:catalog:small")}
        </Button>
        <Button onClick={() => {}}>{t("widgets:catalog:standard")}</Button>
      </div>
    </SectionCard>
  );
}

// Transposed comparison (row = metric, column = variant), best value
// highlighted — for scenario/offer comparisons.
function ComparisonDemo(): ReactNode {
  const t = useTranslation();
  const locale = useLocale().locale();
  const scenarios = [
    { name: "A", rate: 890, interest: 84000 },
    { name: "B", rate: 940, interest: 71000 },
  ];
  const minIndex = (pick: (s: (typeof scenarios)[number]) => number): number => {
    let bestI = 0;
    let bestV = Number.POSITIVE_INFINITY;
    scenarios.forEach((s, i) => {
      const v = pick(s);
      if (v < bestV) {
        bestV = v;
        bestI = i;
      }
    });
    return bestI;
  };
  return (
    <SectionCard title={t("widgets:catalog:comparison")}>
      <ComparisonTable
        columns={scenarios}
        columnHeader={(s) => s.name}
        columnKey={(s) => s.name}
        metricLabel={t("widgets:catalog:metric")}
        metrics={[
          {
            label: t("widgets:catalog:monthly-rate"),
            value: (s) => euro(s.rate, locale),
            bestIndex: () => minIndex((s) => s.rate),
          },
          {
            label: t("widgets:catalog:total-interest"),
            value: (s) => euro(s.interest, locale),
            bestIndex: () => minIndex((s) => s.interest),
          },
        ]}
      />
    </SectionCard>
  );
}

// Live-input calculator: useDraft → pure calculation → ResultPanel/ResultTable.
// Shows the form kit carries the apps' calculator pattern without custom CSS.
interface CalcDraft {
  readonly sum: number | undefined;
  readonly interest: number | undefined;
  readonly repayment: number | undefined;
}

const CALC_DEFAULTS: CalcDraft = { sum: 300000, interest: 3.8, repayment: 2 };

function FinancingCalculatorDemo(): ReactNode {
  const t = useTranslation();
  const locale = useLocale().locale();
  const { draft, field } = useDraft<CalcDraft>(CALC_DEFAULTS);
  const ready = draft.sum !== undefined && draft.interest !== undefined;
  const rate = ready
    ? Math.round((draft.sum * ((draft.interest + (draft.repayment ?? 0)) / 100)) / 12)
    : 0;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <SectionCard title={t("widgets:catalog:financing")}>
        <MoneyField label={t("widgets:catalog:loan")} {...field("sum")} required />
        <PercentField label={t("widgets:catalog:nominal-rate")} {...field("interest")} required />
        <PercentField label={t("widgets:catalog:repayment")} {...field("repayment")} />
      </SectionCard>
      <ResultPanel
        title={t("widgets:catalog:result")}
        empty={!ready}
        emptyText={t("widgets:catalog:enter-loan-and-interest")}
        rows={[
          { label: t("widgets:catalog:loan"), value: euro(draft.sum ?? 0, locale) },
          { label: t("widgets:catalog:monthly-rate"), value: euro(rate, locale), emphasize: true },
        ]}
      >
        <ResultTable
          columns={[
            {
              header: t("widgets:catalog:tranche"),
              cell: (r: { label: string; rate: number }) => r.label,
            },
            {
              header: t("widgets:catalog:rate"),
              align: "right",
              cell: (r) => euro(r.rate, locale),
            },
          ]}
          rows={[{ label: t("widgets:catalog:bank-loan"), rate }]}
          rowKey={(r) => r.label}
        />
      </ResultPanel>
    </div>
  );
}
