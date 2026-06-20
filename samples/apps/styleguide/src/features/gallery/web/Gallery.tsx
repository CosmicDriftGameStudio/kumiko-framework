import { usePrimitives } from "@cosmicdrift/kumiko-renderer-web";
import { Check, ChevronDown, Search, X } from "lucide-react";
import type { ReactNode } from "react";

// Literal Tailwind-Klassen (kein `bg-${token}`) — der v4-Scanner generiert nur
// Klassen die wörtlich im Source stehen.
const SWATCHES: ReadonlyArray<readonly [string, string]> = [
  ["background", "bg-background"],
  ["foreground", "bg-foreground"],
  ["card", "bg-card"],
  ["primary", "bg-primary"],
  ["secondary", "bg-secondary"],
  ["muted", "bg-muted"],
  ["accent", "bg-accent"],
  ["destructive", "bg-destructive"],
];

const RADII: ReadonlyArray<readonly [string, string]> = [
  ["sm", "rounded-sm"],
  ["md", "rounded-md"],
  ["lg", "rounded-lg"],
  ["xl", "rounded-xl"],
];

const SHADOWS: ReadonlyArray<readonly [string, string]> = [
  ["sm", "shadow-sm"],
  ["base", "shadow"],
  ["md", "shadow-md"],
  ["lg", "shadow-lg"],
];

const SPACES: ReadonlyArray<readonly [string, string]> = [
  ["1", "w-1"],
  ["2", "w-2"],
  ["4", "w-4"],
  ["6", "w-6"],
  ["8", "w-8"],
  ["12", "w-12"],
];

const FILTER_PILLS: ReadonlyArray<readonly [string, boolean]> = [
  ["Stocks", false],
  ["ETFs", true],
  ["REITs", false],
];

interface Holding {
  readonly ticker: string;
  readonly name: string;
  readonly shares: string;
  readonly since: string;
  readonly type: string;
  readonly value: string;
}
const HOLDINGS: readonly Holding[] = [
  {
    ticker: "VOO",
    name: "Vanguard S&P 500 ETF",
    shares: "112",
    since: "Jan 2021",
    type: "ETF",
    value: "$48,230.40",
  },
  {
    ticker: "VIG",
    name: "Vanguard Dividend Appreciation",
    shares: "450",
    since: "Mar 2022",
    type: "ETF",
    value: "$26,033.79",
  },
  {
    ticker: "AAPL",
    name: "Apple Inc.",
    shares: "85",
    since: "Nov 2020",
    type: "Stock",
    value: "$18,488.90",
  },
  {
    ticker: "O",
    name: "Realty Income Corp",
    shares: "320",
    since: "Jun 2023",
    type: "REIT",
    value: "$15,136.59",
  },
];

interface InvoiceItem {
  readonly item: string;
  readonly qty: string;
  readonly rate: string;
  readonly amount: string;
}
const INVOICE_ITEMS: readonly InvoiceItem[] = [
  { item: "Design System License", qty: "1", rate: "$499.00", amount: "$499.00" },
  { item: "Priority Support", qty: "12", rate: "$99.00", amount: "$1,188.00" },
  { item: "Custom Components", qty: "3", rate: "$250.00", amount: "$750.00" },
];

interface Bar {
  readonly k: string;
  readonly h: number;
}
interface Dividend {
  readonly name: string;
  readonly shares: string;
  readonly amount: string;
  readonly bars: readonly Bar[];
}
function bars(heights: readonly [number, number, number, number]): readonly Bar[] {
  return heights.map((h, i) => ({ k: "abcd"[i] as string, h }));
}
const DIVIDENDS: readonly Dividend[] = [
  { name: "Vanguard VIG", shares: "450", amount: "$1,842.10", bars: bars([14, 14, 14, 22]) },
  { name: "S&P 500 VOO", shares: "112", amount: "$928.40", bars: bars([14, 16, 24, 14]) },
  { name: "Apple AAPL", shares: "85", amount: "$340.00", bars: bars([12, 14, 22, 14]) },
  { name: "Realty Income", shares: "320", amount: "$1,139.50", bars: bars([18, 18, 18, 24]) },
];

interface Target {
  readonly label: string;
  readonly total: string;
  readonly pct: string;
  readonly current: string;
}
const TARGETS: readonly Target[] = [
  { label: "Retirement", total: "$420,000", pct: "65%", current: "$273,000" },
  { label: "Real Estate", total: "$85,000", pct: "32%", current: "$27,200" },
];

function Block({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}): ReactNode {
  return (
    <section data-testid={`sg-${id}`} className="border-border border-b px-8 py-8">
      <h2 className="text-muted-foreground mb-4 text-xs font-semibold uppercase tracking-wider">
        {title}
      </h2>
      {children}
    </section>
  );
}

// Outline-Badge im dashboard-01-Stil (px-1.5, muted-foreground).
function Badge({ children }: { children: ReactNode }): ReactNode {
  return (
    <span className="border-border text-muted-foreground inline-flex items-center rounded-md border px-1.5 py-0.5 text-xs font-medium">
      {children}
    </span>
  );
}

// Select-Attrappe (shadcn-Select-Trigger-Look) für statische Showcase-Blöcke.
function SelectStub({ value }: { value: string }): ReactNode {
  return (
    <div className="border-input bg-background flex h-9 items-center justify-between rounded-md border px-3 text-sm">
      <span>{value}</span>
      <ChevronDown className="text-muted-foreground size-4" />
    </div>
  );
}

export function Gallery(): ReactNode {
  const { Button, Field, Input } = usePrimitives();
  const noop = (): void => {};

  return (
    <div className="mx-auto max-w-4xl">
      <Block id="colors" title="Colors">
        <div className="flex flex-wrap gap-4">
          {SWATCHES.map(([name, cls]) => (
            <div key={name} className="flex flex-col items-center gap-1">
              <div className={`border-border size-16 rounded-md border ${cls}`} />
              <span className="text-muted-foreground text-xs">{name}</span>
            </div>
          ))}
        </div>
      </Block>

      <Block id="typography" title="Typography">
        <div className="space-y-2">
          <p className="text-3xl font-bold">Heading 3xl — the quick brown fox</p>
          <p className="text-2xl font-semibold">Heading 2xl — the quick brown fox</p>
          <p className="text-xl font-semibold">Heading xl — the quick brown fox</p>
          <p className="text-lg font-medium">Heading lg — the quick brown fox</p>
          <p className="text-base">Body base — the quick brown fox jumps over the lazy dog</p>
          <p className="text-sm">Small — the quick brown fox jumps over the lazy dog</p>
          <p className="text-muted-foreground text-xs">Muted xs — secondary helper text</p>
        </div>
      </Block>

      <Block id="buttons" title="Buttons">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary">Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="danger">Danger</Button>
          <Button variant="primary" disabled>
            Disabled
          </Button>
          <Button variant="primary" loading>
            Loading
          </Button>
        </div>
      </Block>

      <Block id="inputs" title="Inputs">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field id="in-default" label="Default">
            <Input
              kind="text"
              id="in-default"
              name="in-default"
              value="Acme Inc."
              onChange={noop}
            />
          </Field>
          <Field id="in-placeholder" label="Placeholder">
            <Input
              kind="text"
              id="in-placeholder"
              name="in-placeholder"
              value=""
              onChange={noop}
              placeholder="Enter a name…"
            />
          </Field>
          <Field id="in-required" label="Required" required>
            <Input
              kind="text"
              id="in-required"
              name="in-required"
              value=""
              onChange={noop}
              placeholder="Required field"
            />
          </Field>
          <Field
            id="in-error"
            label="With error"
            issues={[{ path: "field", code: "invalid", i18nKey: "gallery.field-error" }]}
          >
            <Input
              kind="text"
              id="in-error"
              name="in-error"
              value="not-an-email"
              onChange={noop}
              hasError
            />
          </Field>
          <Field id="in-disabled" label="Disabled">
            <Input
              kind="text"
              id="in-disabled"
              name="in-disabled"
              value="Locked value"
              onChange={noop}
              disabled
            />
          </Field>
        </div>
      </Block>

      <Block id="filter" title="Filter & Search">
        {/* Holdings-Muster: Such-Pill (rounded-full, muted) links + Toggle-
            Group-Pills rechts; Rows mit Ticker-Kachel, Meta, Type-Badge, Value. */}
        <div className="bg-card rounded-xl border p-2 shadow-sm">
          <div className="flex items-center gap-3 p-2">
            <div className="relative min-w-0 flex-1">
              <Search className="text-muted-foreground absolute left-3 top-1/2 size-4 -translate-y-1/2" />
              <input
                className="bg-muted/50 placeholder:text-muted-foreground focus-visible:ring-ring h-10 w-full rounded-full border-none pl-9 pr-4 text-sm outline-none focus-visible:ring-2"
                placeholder="Search holdings or tickers…"
                readOnly
              />
            </div>
            <div className="flex items-center gap-2">
              {FILTER_PILLS.map(([label, active]) => (
                <span
                  key={label}
                  className={
                    active
                      ? "bg-secondary text-secondary-foreground inline-flex h-9 items-center rounded-full border border-transparent px-4 text-sm font-medium"
                      : "border-border text-muted-foreground inline-flex h-9 items-center rounded-full border px-4 text-sm font-medium"
                  }
                >
                  {label}
                </span>
              ))}
            </div>
          </div>
          <div className="mt-1 space-y-1">
            {HOLDINGS.map((h) => (
              <div
                key={h.ticker}
                className="hover:bg-muted/50 flex items-center gap-4 rounded-lg px-3 py-3"
              >
                <div className="border-border flex size-11 shrink-0 items-center justify-center rounded-md border text-xs font-bold">
                  {h.ticker}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{h.name}</div>
                  <div className="text-muted-foreground text-xs uppercase tracking-wide">
                    {h.shares} shares · {h.since}
                  </div>
                </div>
                <Badge>{h.type}</Badge>
                <div className="text-right">
                  <div className="text-muted-foreground text-[10px] uppercase tracking-wider">
                    Value
                  </div>
                  <div className="font-semibold tabular-nums">{h.value}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </Block>

      <Block id="login" title="Login">
        <div className="bg-muted/30 flex justify-center rounded-lg border border-dashed p-8">
          <div className="bg-card w-full max-w-sm rounded-xl border p-6 shadow-sm">
            <div className="flex flex-col gap-1 text-center">
              <h3 className="text-xl font-semibold">Login to your account</h3>
              <p className="text-muted-foreground text-sm">
                Enter your email below to login to your account
              </p>
            </div>
            <div className="mt-6 flex flex-col gap-4">
              <Field id="lg-email" label="Email">
                <Input
                  kind="text"
                  id="lg-email"
                  name="lg-email"
                  value=""
                  onChange={noop}
                  placeholder="m@example.com"
                />
              </Field>
              <div className="grid gap-2">
                <div className="flex items-center justify-between">
                  <label htmlFor="lg-pass" className="text-sm font-medium">
                    Password
                  </label>
                  <span className="text-muted-foreground text-sm underline-offset-4 hover:underline">
                    Forgot your password?
                  </span>
                </div>
                <Input
                  kind="text"
                  id="lg-pass"
                  name="lg-pass"
                  value=""
                  onChange={noop}
                  placeholder="••••••••"
                />
              </div>
              <Button variant="primary">Login</Button>
              <Button variant="secondary">Login with Google</Button>
            </div>
            <p className="text-muted-foreground mt-4 text-center text-sm">
              Don&apos;t have an account?{" "}
              <span className="text-foreground underline underline-offset-4">Sign up</span>
            </p>
          </div>
        </div>
      </Block>

      <Block id="invoice" title="Invoice">
        <div className="bg-card max-w-xl rounded-xl border shadow-sm">
          <div className="flex items-start justify-between border-b px-6 py-4">
            <div>
              <h3 className="font-semibold">Invoice #INV-2847</h3>
              <p className="text-muted-foreground text-sm">Due March 30, 2026</p>
            </div>
            <Badge>Pending</Badge>
          </div>
          <div className="px-6 py-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted-foreground border-border border-b">
                  <th className="py-2 text-left font-medium">Item</th>
                  <th className="py-2 text-right font-medium">Qty</th>
                  <th className="py-2 text-right font-medium">Rate</th>
                  <th className="py-2 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {INVOICE_ITEMS.map((it) => (
                  <tr key={it.item} className="border-border border-b">
                    <td className="py-2.5">{it.item}</td>
                    <td className="py-2.5 text-right tabular-nums">{it.qty}</td>
                    <td className="py-2.5 text-right tabular-nums">{it.rate}</td>
                    <td className="py-2.5 text-right tabular-nums">{it.amount}</td>
                  </tr>
                ))}
                <tr className="text-muted-foreground">
                  <td />
                  <td />
                  <td className="py-2.5 text-right">Subtotal</td>
                  <td className="py-2.5 text-right tabular-nums">$2,437.00</td>
                </tr>
                <tr className="text-muted-foreground">
                  <td />
                  <td />
                  <td className="py-1 text-right">Tax</td>
                  <td className="py-1 text-right tabular-nums">$0.00</td>
                </tr>
                <tr className="border-border border-t font-semibold">
                  <td />
                  <td />
                  <td className="py-2.5 text-right">Total Due</td>
                  <td className="py-2.5 text-right tabular-nums">$2,437.00</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="flex justify-between gap-2 border-t px-6 py-4">
            <Button variant="secondary">Download PDF</Button>
            <Button variant="primary">Pay Now</Button>
          </div>
        </div>
      </Block>

      <Block id="shipping" title="Shipping Address">
        <div className="bg-card max-w-xl rounded-xl border shadow-sm">
          <div className="border-b px-6 py-4">
            <h3 className="font-semibold">Shipping Address</h3>
            <p className="text-muted-foreground text-sm">Where should we deliver?</p>
          </div>
          <div className="flex flex-col gap-4 px-6 py-6">
            <Field id="sh-street" label="Street address">
              <Input
                kind="text"
                id="sh-street"
                name="sh-street"
                value=""
                onChange={noop}
                placeholder="123 Main Street"
              />
            </Field>
            <Field id="sh-apt" label="Apt / Suite">
              <Input
                kind="text"
                id="sh-apt"
                name="sh-apt"
                value=""
                onChange={noop}
                placeholder="Apt 4B"
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="sh-city" label="City">
                <Input
                  kind="text"
                  id="sh-city"
                  name="sh-city"
                  value=""
                  onChange={noop}
                  placeholder="San Francisco"
                />
              </Field>
              <div className="grid gap-2">
                <span className="text-sm font-medium">State</span>
                <SelectStub value="California" />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="sh-zip" label="ZIP Code">
                <Input
                  kind="text"
                  id="sh-zip"
                  name="sh-zip"
                  value=""
                  onChange={noop}
                  placeholder="94102"
                />
              </Field>
              <div className="grid gap-2">
                <span className="text-sm font-medium">Country</span>
                <SelectStub value="United States" />
              </div>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="border-primary bg-primary flex size-4 items-center justify-center rounded-[4px]">
                <Check className="text-primary-foreground size-3" />
              </span>
              Save as default address
            </div>
          </div>
          <div className="flex justify-between gap-2 border-t px-6 py-4">
            <Button variant="secondary">Cancel</Button>
            <Button variant="primary">Save Address</Button>
          </div>
        </div>
      </Block>

      <Block id="profile" title="Profile">
        <div className="bg-card max-w-xl rounded-xl border shadow-sm">
          <div className="border-b px-6 py-4">
            <h3 className="font-semibold">Profile</h3>
            <p className="text-muted-foreground text-sm">
              Update your personal information and how others see you.
            </p>
          </div>
          <div className="flex flex-col gap-5 px-6 py-6">
            <div className="flex items-center gap-4">
              <div className="bg-muted text-foreground flex size-16 items-center justify-center rounded-full text-lg font-semibold">
                MF
              </div>
              <Button variant="secondary">Change avatar</Button>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="pf-name" label="Full name">
                <Input kind="text" id="pf-name" name="pf-name" value="Marc Frost" onChange={noop} />
              </Field>
              <Field id="pf-email" label="Email">
                <Input
                  kind="text"
                  id="pf-email"
                  name="pf-email"
                  value="marc@cosmicdrift.dev"
                  onChange={noop}
                />
              </Field>
            </div>
            <Field id="pf-bio" label="Bio">
              <Input
                kind="text"
                id="pf-bio"
                name="pf-bio"
                value="Building Kumiko at Cosmic Drift Game Studio."
                onChange={noop}
              />
            </Field>
          </div>
          <div className="flex justify-end gap-2 border-t px-6 py-4">
            <Button variant="secondary">Cancel</Button>
            <Button variant="primary">Save changes</Button>
          </div>
        </div>
      </Block>

      <Block id="dividends" title="Dividends">
        <div className="bg-card max-w-xl rounded-xl border p-6 shadow-sm">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="font-semibold">Q2 Dividend Income</h3>
              <p className="text-muted-foreground text-sm">
                Quarterly dividend payouts across your portfolio holdings.
              </p>
            </div>
            <span className="text-muted-foreground hover:text-foreground">
              <X className="size-4" />
            </span>
          </div>
          <div className="mt-4 space-y-3">
            {DIVIDENDS.map((d) => (
              <div
                key={d.name}
                className="bg-muted/40 flex items-center gap-4 rounded-lg px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{d.name}</div>
                  <div className="text-muted-foreground text-sm">{d.shares} Shares</div>
                </div>
                <div className="flex h-6 items-end gap-1">
                  {d.bars.map((b) => (
                    <span
                      key={`${d.name}-${b.k}`}
                      className="bg-muted-foreground/40 w-2 rounded-sm"
                      style={{ height: `${b.h}px` }}
                    />
                  ))}
                </div>
                <div className="font-semibold tabular-nums">{d.amount}</div>
              </div>
            ))}
          </div>
        </div>
      </Block>

      <Block id="savings" title="Savings Targets">
        <div className="bg-card max-w-xl rounded-xl border p-6 shadow-sm">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="font-semibold">Savings Targets</h3>
              <p className="text-muted-foreground text-sm">Active milestones for 2024</p>
            </div>
            <Badge>New Goal</Badge>
          </div>
          <div className="mt-4 space-y-3">
            {TARGETS.map((t) => (
              <div key={t.label} className="bg-muted/40 rounded-lg px-4 py-4">
                <div className="text-muted-foreground text-xs font-medium uppercase tracking-wider">
                  {t.label}
                </div>
                <div className="mt-1 text-3xl font-bold tabular-nums">{t.total}</div>
                <div className="bg-muted mt-3 h-1.5 overflow-hidden rounded-full">
                  <div className="bg-foreground h-full rounded-full" style={{ width: t.pct }} />
                </div>
                <div className="text-muted-foreground mt-2 flex justify-between text-sm">
                  <span>{t.pct} achieved</span>
                  <span className="text-foreground font-medium tabular-nums">{t.current}</span>
                </div>
              </div>
            ))}
          </div>
          <p className="text-muted-foreground mt-4 text-sm">
            You have not met your targets for this year.
          </p>
        </div>
      </Block>

      <Block id="cards" title="Cards">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="border-border bg-card rounded-lg border p-6 shadow-sm">
            <h3 className="font-semibold">Plain card</h3>
            <p className="text-muted-foreground text-sm">
              bg-card · border · rounded-lg · shadow-sm · p-6
            </p>
          </div>
          <div className="border-border bg-card rounded-lg border shadow-sm">
            <div className="border-border border-b px-6 py-3 font-semibold">Card header</div>
            <div className="text-muted-foreground px-6 py-4 text-sm">Body content sits here.</div>
            <div className="border-border flex justify-end gap-2 border-t px-6 py-3">
              <Button variant="secondary">Cancel</Button>
              <Button variant="primary">Save</Button>
            </div>
          </div>
        </div>
      </Block>

      <Block id="nav" title="Navigation">
        {/* ponytail: statischer Nachbau des Nav-Standards — die LIVE-Nav ist
            die Sidebar links (NavTree), hier isoliert für die Doku. */}
        <div className="bg-card w-60 rounded-lg border p-3 text-sm shadow-sm">
          <div className="text-muted-foreground/70 px-2 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wider">
            Workspace
          </div>
          <div className="bg-accent text-foreground flex h-7 items-center gap-2 rounded-md px-2 font-medium">
            <span className="bg-accent-foreground inline-block size-1.5 rounded-full" />
            Dashboard
          </div>
          <div className="text-muted-foreground flex h-7 items-center gap-2 rounded-md px-2">
            <span className="bg-muted-foreground/40 inline-block size-1.5 rounded-full" />
            Orders
          </div>
          <div className="text-muted-foreground flex h-7 items-center gap-2 rounded-md px-2">
            <span className="bg-muted-foreground/40 inline-block size-1.5 rounded-full" />
            Settings
          </div>
        </div>
      </Block>

      <Block id="radius" title="Radius">
        <div className="flex flex-wrap items-end gap-4">
          {RADII.map(([name, cls]) => (
            <div key={name} className="flex flex-col items-center gap-1">
              <div className={`border-border bg-muted size-16 border ${cls}`} />
              <span className="text-muted-foreground text-xs">{name}</span>
            </div>
          ))}
        </div>
      </Block>

      <Block id="elevation" title="Elevation">
        <div className="flex flex-wrap items-end gap-6">
          {SHADOWS.map(([name, cls]) => (
            <div key={name} className="flex flex-col items-center gap-2">
              <div className={`bg-card size-16 rounded-lg ${cls}`} />
              <span className="text-muted-foreground text-xs">{name}</span>
            </div>
          ))}
        </div>
      </Block>

      <Block id="spacing" title="Spacing">
        <div className="space-y-2">
          {SPACES.map(([name, cls]) => (
            <div key={name} className="flex items-center gap-3">
              <div className={`bg-primary h-3 ${cls}`} />
              <span className="text-muted-foreground text-xs">{name}</span>
            </div>
          ))}
        </div>
      </Block>
    </div>
  );
}
