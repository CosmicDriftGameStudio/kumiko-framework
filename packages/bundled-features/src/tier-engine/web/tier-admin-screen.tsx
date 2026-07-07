// @runtime client
// TierAdminScreen — SystemAdmin weist einem beliebigen Tenant ein Tier zu,
// ohne Billing-Kauf. Tenant-Picker (tenant:query:list) → aktuelles Tier
// (get-tenant-tier) → Tier-Dropdown (tier-options) → Speichern
// (set-tenant-tier). Apps registrieren die Komponente als custom-Screen:
//   r.screen({ id: "tier-admin", type: "custom",
//     renderer: { react: { __component: "TierAdminScreen" } },
//     access: { roles: ["SystemAdmin"] } })

import {
  useDispatcher,
  usePrimitives,
  useQuery,
  useTranslation,
} from "@cosmicdrift/kumiko-renderer";
import { FormScreenShell } from "@cosmicdrift/kumiko-renderer-web";
import { type ReactNode, useEffect, useState } from "react";
import { TierEngineHandlers, TierEngineQueries } from "../constants";

const TENANT_LIST_QUERY = "tenant:query:list";

type TenantRow = { readonly id: string; readonly name: string };
type TenantListResponse = { readonly rows: readonly TenantRow[] };
type TierAssignmentRow = { readonly tier: string; readonly source: string | null };
type TierOptionsResponse = { readonly tiers: readonly string[] };
type SetTenantTierResponse = {
  readonly tenantId: string;
  readonly tier: string;
  readonly isNew: boolean;
};

type Status =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success"; tier: string }
  | { kind: "error"; messageKey: string };

export function TierAdminScreen(): ReactNode {
  const t = useTranslation();
  const { Field, Input, Button, Banner, Form, Text } = usePrimitives();
  const dispatcher = useDispatcher();

  // ponytail: nur die erste Seite (default-limit, nextCursor ignoriert) —
  // reicht für Apps mit wenigen Tenants (cashcolt). Pagination/Suche
  // nachrüsten, wenn ein Operator mit vielen Tenants nicht alle sieht.
  const tenantsQuery = useQuery<TenantListResponse | null>(TENANT_LIST_QUERY, {});
  const tierOptionsQuery = useQuery<TierOptionsResponse | null>(TierEngineQueries.tierOptions, {});

  const [tenantId, setTenantId] = useState("");
  const [tier, setTier] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const currentTierQuery = useQuery<TierAssignmentRow | null>(
    TierEngineQueries.getTenantTier,
    { tenantId },
    { enabled: tenantId !== "" },
  );

  // Tenant-Wechsel: Auswahl + Status zurücksetzen, damit kein Tier eines
  // anderen Tenants stehen bleibt (Mis-Grant-Schutz auf UI-Ebene). tenantId
  // ist hier reiner Trigger (Body liest es nicht) — Biome's "extra dep"-
  // Autofix würde die Deps leeren und den Reset auf den Mount beschränken.
  // biome-ignore lint/correctness/useExhaustiveDependencies: tenantId ist der gewollte Reset-Trigger, nicht entfernen.
  useEffect(() => {
    setTier("");
    setStatus({ kind: "idle" });
  }, [tenantId]);

  const tenantOptions = (tenantsQuery.data?.rows ?? []).map((row) => ({
    value: row.id,
    label: row.name,
  }));
  const tierOptions = tierOptionsQuery.data?.tiers ?? [];
  const currentTier = currentTierQuery.data?.tier ?? null;

  const onSave = async (): Promise<void> => {
    if (tenantId === "" || tier === "") return;
    setStatus({ kind: "submitting" });
    const res = await dispatcher.write<SetTenantTierResponse>(TierEngineHandlers.setTenantTier, {
      tenantId,
      tier,
    });
    if (!res.isSuccess) {
      setStatus({ kind: "error", messageKey: "tier-admin.error.generic" });
      return;
    }
    setStatus({ kind: "success", tier: res.data.tier });
    void currentTierQuery.refetch();
  };

  const submitting = status.kind === "submitting";
  const canSubmit = tenantId !== "" && tier !== "" && !submitting;

  return (
    <FormScreenShell testId="tier-admin-screen" className="flex flex-col gap-6">
      <Text variant="small">{t("tier-admin.explainer")}</Text>

      {tenantsQuery.error !== null && (
        <Banner variant="error" testId="tier-admin-load-error">
          {t("tier-admin.error.load")}
        </Banner>
      )}
      {tierOptions.length === 0 && tierOptionsQuery.loading !== true && (
        <Banner variant="info" testId="tier-admin-no-tiers">
          {t("tier-admin.error.noTiers")}
        </Banner>
      )}

      <Form
        testId="tier-admin-form"
        onSubmit={(e) => {
          e?.preventDefault();
          void onSave();
        }}
        actions={
          <Button
            type="submit"
            disabled={!canSubmit}
            loading={submitting}
            testId="tier-admin-submit"
          >
            {t("tier-admin.submit")}
          </Button>
        }
      >
        <Field id="tier-admin-tenant" label={t("tier-admin.tenant.label")} required>
          <Input
            kind="select"
            id="tier-admin-tenant"
            name="tier-admin-tenant"
            value={tenantId}
            onChange={setTenantId}
            options={tenantOptions}
          />
        </Field>

        {tenantId !== "" && (
          <Text variant="small" testId="tier-admin-current">
            {t("tier-admin.current.label")}: {currentTier ?? t("tier-admin.current.none")}
          </Text>
        )}

        <Field id="tier-admin-tier" label={t("tier-admin.tier.label")} required>
          <Input
            kind="select"
            id="tier-admin-tier"
            name="tier-admin-tier"
            value={tier}
            onChange={setTier}
            options={tierOptions}
            disabled={tierOptions.length === 0}
          />
        </Field>

        {status.kind === "success" && (
          <Banner variant="info" testId="tier-admin-success">
            {t("tier-admin.success", { tier: status.tier })}
          </Banner>
        )}
        {status.kind === "error" && (
          <Banner variant="error" testId="tier-admin-error">
            {t(status.messageKey)}
          </Banner>
        )}
      </Form>
    </FormScreenShell>
  );
}
