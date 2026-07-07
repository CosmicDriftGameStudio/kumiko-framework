// @runtime client
// PatTokensScreen — logged-in self-service for Personal Access Tokens. Two-axis
// scopes (like GitHub fine-grained PATs): per API domain pick a permission LEVEL
// (no access / read / read & write). Mint → copy the plaintext ONCE → it's never
// re-displayed. Layout follows the framework's polished-screen convention (Form
// primitive + Tailwind), cards match the mh style. The feature registers this
// dormant (r.screen); the app places it via r.nav.

import {
  useDispatcher,
  usePrimitives,
  useQuery,
  useTranslation,
} from "@cosmicdrift/kumiko-renderer";
import { type ReactNode, useState } from "react";
import { PatHandlers, PatQueries } from "../constants";
import { parseGrant } from "../scopes";

type ScopeDomain = { readonly name: string; readonly label: string; readonly canWrite: boolean };
type TokenRow = {
  readonly id: string;
  readonly name: string;
  readonly scopes: readonly string[];
  readonly createdAt: string | null;
  readonly expiresAt: string | null;
  readonly revokedAt: string | null;
};

type Level = "none" | "read" | "write";
type ExpiryKey = "30d" | "90d" | "1y" | "never";
const EXPIRY_DAYS: Record<ExpiryKey, number | undefined> = {
  "30d": 30,
  "90d": 90,
  "1y": 365,
  never: undefined,
};

// Timestamps arrive as ISO strings over the JSON API — slice the date part
// without touching the banned Date API.
function isoDate(value: string | null): string | null {
  return typeof value === "string" && value.length >= 10 ? value.slice(0, 10) : null;
}

export function PatTokensScreen({
  embedded = false,
}: {
  readonly embedded?: boolean;
} = {}): ReactNode {
  const t = useTranslation();
  const { Form, Field, Input, Button, Banner, Card, Heading } = usePrimitives();
  const dispatcher = useDispatcher();

  const scopesQuery = useQuery<readonly ScopeDomain[]>(PatQueries.availableScopes, {});
  const listQuery = useQuery<readonly TokenRow[]>(PatQueries.mine, {});

  const [name, setName] = useState("");
  const [levels, setLevels] = useState<Readonly<Record<string, Level>>>({});
  const [expiry, setExpiry] = useState<ExpiryKey>("90d");
  const [minted, setMinted] = useState<{ token: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const domains = scopesQuery.data ?? [];
  const tokens = listQuery.data ?? [];
  const labelOf = (domain: string): string =>
    domains.find((d) => d.name === domain)?.label ?? domain;

  // Granted scopes = "<domain>:<level>" for every domain not set to "none".
  const grants = (): string[] =>
    Object.entries(levels)
      .filter(([, l]) => l !== "none")
      .map(([domain, l]) => `${domain}:${l}`);

  const setLevel = (domain: string, level: Level): void =>
    setLevels((cur) => ({ ...cur, [domain]: level }));

  const create = async (): Promise<void> => {
    if (name.trim() === "") return setError(t("pat.create.needName"));
    const scopes = grants();
    if (scopes.length === 0) return setError(t("pat.create.needScope"));
    setBusy(true);
    setError(null);
    const days = EXPIRY_DAYS[expiry];
    const res = await dispatcher.write(PatHandlers.create, {
      name: name.trim(),
      scopes,
      ...(days !== undefined ? { expiresInDays: days } : {}),
    });
    setBusy(false);
    if (!res.isSuccess) return setError(t("pat.error.generic"));
    setMinted({ token: (res.data as { token: string }).token });
    setCopied(false);
    setName("");
    setLevels({});
    setExpiry("90d");
    void listQuery.refetch?.();
  };

  const copy = async (): Promise<void> => {
    if (!minted) return;
    try {
      await navigator.clipboard.writeText(minted.token);
      setCopied(true);
    } catch {
      // clipboard blocked (non-secure context) — the token stays selectable in place
    }
  };

  const revoke = async (id: string): Promise<void> => {
    const res = await dispatcher.write(PatHandlers.revoke, { id });
    if (!res.isSuccess) return setError(t("pat.error.generic"));
    void listQuery.refetch?.();
  };

  // "Pages (read & write) · Tags (read) · Valid until … · Created …"
  const meta = (row: TokenRow): string => {
    const scopeText = row.scopes
      .map((g) => {
        const p = parseGrant(g);
        if (!p) return g;
        const lvl = p.level === "write" ? t("pat.level.write") : t("pat.level.read");
        return `${labelOf(p.domain)} (${lvl})`;
      })
      .join(" · ");
    const d = isoDate(row.expiresAt);
    const parts = [
      scopeText,
      d ? t("pat.list.validUntil", { date: d }) : t("pat.list.neverExpires"),
    ];
    const created = isoDate(row.createdAt);
    if (created) parts.push(t("pat.list.created", { date: created }));
    return parts.join("  ·  ");
  };

  return (
    <div className={embedded ? "flex flex-col gap-6" : "flex max-w-3xl flex-col gap-6 p-6"}>
      <Heading>{t("pat.title")}</Heading>

      {minted && (
        <Banner
          variant="info"
          actions={
            <>
              <Button variant="primary" onClick={copy}>
                {copied ? t("pat.created.copied") : t("pat.created.copy")}
              </Button>
              <Button variant="secondary" onClick={() => setMinted(null)}>
                {t("pat.created.dismiss")}
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-2">
            <span className="text-sm">{t("pat.created.hint")}</span>
            <code className="block break-all rounded bg-muted px-3 py-2 font-mono text-sm">
              {minted.token}
            </code>
          </div>
        </Banner>
      )}

      {error && <Banner variant="error">{error}</Banner>}

      <Form
        title={t("pat.create.title")}
        subtitle={t("pat.create.subtitle")}
        onSubmit={create}
        actions={
          <Button type="submit" variant="primary" onClick={create} loading={busy} disabled={busy}>
            {t("pat.create.submit")}
          </Button>
        }
      >
        <Field id="pat-name" label={t("pat.create.name")} required>
          <Input
            kind="text"
            id="pat-name"
            name="name"
            value={name}
            onChange={setName}
            placeholder={t("pat.create.namePlaceholder")}
            disabled={busy}
          />
        </Field>

        {domains.map((d) => (
          <Field key={d.name} id={`pat-scope-${d.name}`} label={d.label}>
            <Input
              kind="select"
              id={`pat-scope-${d.name}`}
              name={d.name}
              value={levels[d.name] ?? "none"}
              onChange={(v) => setLevel(d.name, v as Level)}
              options={[
                { value: "none", label: t("pat.level.none") },
                { value: "read", label: t("pat.level.read") },
                ...(d.canWrite ? [{ value: "write", label: t("pat.level.write") }] : []),
              ]}
              disabled={busy}
            />
          </Field>
        ))}

        <Field id="pat-expiry" label={t("pat.create.expiry")}>
          <Input
            kind="select"
            id="pat-expiry"
            name="expiry"
            value={expiry}
            onChange={(v) => setExpiry(v as ExpiryKey)}
            options={[
              { value: "30d", label: t("pat.expiry.30d") },
              { value: "90d", label: t("pat.expiry.90d") },
              { value: "1y", label: t("pat.expiry.1y") },
              { value: "never", label: t("pat.expiry.never") },
            ]}
            disabled={busy}
          />
        </Field>
      </Form>

      <div className="flex flex-col gap-3">
        <Heading>{t("pat.list.title")}</Heading>
        {tokens.length === 0 && (
          <span className="text-sm text-muted-foreground">{t("pat.list.empty")}</span>
        )}
        {tokens.map((row) => {
          const revoked = row.revokedAt !== null;
          return (
            <Card
              key={row.id}
              options={{ padded: false }}
              className={`p-4 ${revoked ? "opacity-60" : ""}`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-sm font-semibold">{row.name}</span>
                  <span className="whitespace-normal text-xs text-muted-foreground">
                    {revoked ? t("pat.list.revoked") : meta(row)}
                  </span>
                </div>
                {!revoked && (
                  <Button variant="danger" onClick={() => revoke(row.id)}>
                    {t("pat.list.revoke")}
                  </Button>
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
