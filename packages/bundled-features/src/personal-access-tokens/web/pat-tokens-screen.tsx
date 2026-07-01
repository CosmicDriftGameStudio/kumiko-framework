// @runtime client
// PatTokensScreen — logged-in self-service for Personal Access Tokens: mint a
// token (name + scope toggles, plaintext shown once), list your tokens and
// revoke them. The feature registers it dormant (r.screen); the app places it
// via r.nav. Imports only from ../constants (pure) — no server pull-in.

import { useDispatcher, usePrimitives, useQuery, useTranslation } from "@cosmicdrift/kumiko-renderer";
import { type ReactNode, useState } from "react";
import { PatHandlers, PatQueries } from "../constants";

type ScopeOption = { readonly name: string; readonly label: string };
type TokenRow = {
  readonly id: string;
  readonly name: string;
  readonly prefix: string;
  readonly scopes: readonly string[];
  readonly createdAt: string | null;
  readonly expiresAt: string | null;
  readonly revokedAt: string | null;
};

function isExpired(expiresAt: string | null): boolean {
  return expiresAt !== null && new Date(expiresAt).getTime() <= Date.now();
}

export function PatTokensScreen(): ReactNode {
  const t = useTranslation();
  const { Section, Heading, Field, Input, Button, Banner, Card, Text } = usePrimitives();
  const dispatcher = useDispatcher();

  const scopesQuery = useQuery<readonly ScopeOption[]>(PatQueries.availableScopes, {});
  const listQuery = useQuery<readonly TokenRow[]>(PatQueries.mine, {});

  const [name, setName] = useState("");
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [minted, setMinted] = useState<{ token: string; prefix: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const scopes = scopesQuery.data ?? [];
  const tokens = listQuery.data ?? [];

  const toggle = (scope: string): void =>
    setSelected((cur) => (cur.includes(scope) ? cur.filter((s) => s !== scope) : [...cur, scope]));

  const create = async (): Promise<void> => {
    if (name.trim() === "") return setError(t("pat.create.needName"));
    if (selected.length === 0) return setError(t("pat.create.needScope"));
    setBusy(true);
    setError(null);
    const res = await dispatcher.write(PatHandlers.create, {
      name: name.trim(),
      scopes: selected,
    });
    setBusy(false);
    if (!res.isSuccess) return setError(t("pat.error.generic"));
    const data = res.data as { token: string; prefix: string };
    setMinted({ token: data.token, prefix: data.prefix });
    setName("");
    setSelected([]);
    void listQuery.refetch?.();
  };

  const revoke = async (id: string): Promise<void> => {
    const res = await dispatcher.write(PatHandlers.revoke, { id });
    if (!res.isSuccess) return setError(t("pat.error.generic"));
    void listQuery.refetch?.();
  };

  const status = (row: TokenRow): string => {
    if (row.revokedAt !== null) return t("pat.list.revoked");
    if (isExpired(row.expiresAt)) return t("pat.list.expired");
    return "";
  };

  return (
    <Section>
      <Heading>{t("pat.title")}</Heading>

      {minted && (
        <Banner
          variant="info"
          actions={
            <Button variant="secondary" onClick={() => setMinted(null)}>
              {t("pat.created.dismiss")}
            </Button>
          }
        >
          <Heading>{t("pat.created.title")}</Heading>
          <Text>{minted.token}</Text>
          <Text>{t("pat.created.hint")}</Text>
        </Banner>
      )}

      {error && <Banner variant="error">{error}</Banner>}

      <Section>
        <Heading>{t("pat.create.title")}</Heading>
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
        <Text>{t("pat.create.scopes")}</Text>
        {scopes.map((s) => (
          <Button
            key={s.name}
            variant={selected.includes(s.name) ? "primary" : "secondary"}
            onClick={() => toggle(s.name)}
            disabled={busy}
          >
            {s.label}
          </Button>
        ))}
        <Button type="submit" variant="primary" onClick={create} loading={busy} disabled={busy}>
          {t("pat.create.submit")}
        </Button>
      </Section>

      <Section>
        <Heading>{t("pat.list.title")}</Heading>
        {tokens.length === 0 && <Text>{t("pat.list.empty")}</Text>}
        {tokens.map((row) => (
          <Card key={row.id}>
            <Text>
              {row.name} — {row.prefix}… {status(row)}
            </Text>
            <Text>{row.scopes.join(", ")}</Text>
            {row.revokedAt === null && (
              <Button variant="danger" onClick={() => revoke(row.id)}>
                {t("pat.list.revoke")}
              </Button>
            )}
          </Card>
        ))}
      </Section>
    </Section>
  );
}
