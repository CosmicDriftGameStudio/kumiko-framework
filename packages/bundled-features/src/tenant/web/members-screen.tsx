// @runtime client
// MembersScreen — active members + pending invitations for the current tenant.
// Read-only member list; invite + cancel only (no updateMemberRoles — SystemAdmin-only).

import { AuthHandlers } from "@cosmicdrift/kumiko-bundled-features/auth-email-password/constants";
import { useDispatcher, usePrimitives, useTranslation } from "@cosmicdrift/kumiko-renderer";
import { FormScreenShell } from "@cosmicdrift/kumiko-renderer-web";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { DEFAULT_INVITE_ROLE_OPTIONS, TenantHandlers, TenantQueries } from "../constants";

type MemberRow = {
  readonly id: string;
  readonly userId: string;
  readonly tenantId: string;
  readonly email: string | null;
  readonly displayName: string | null;
  readonly roles: readonly string[];
};

type InvitationRow = {
  readonly id: string;
  readonly email: string;
  readonly role: string;
  readonly status: string;
  readonly expiresAt: string;
};

type State =
  | { readonly kind: "loading" }
  | { readonly kind: "error"; readonly message: string }
  | {
      readonly kind: "ready";
      readonly members: readonly MemberRow[];
      readonly invitations: readonly InvitationRow[];
    };

type RoleOption = (typeof DEFAULT_INVITE_ROLE_OPTIONS)[number];

export type MembersScreenProps = {
  /** Invite-role allowlist; defaults to User/Admin/Editor — never reserved/global roles. */
  readonly inviteRoleOptions?: readonly RoleOption[];
};

export function MembersScreen({
  inviteRoleOptions = DEFAULT_INVITE_ROLE_OPTIONS,
}: MembersScreenProps): ReactNode {
  const t = useTranslation();
  const { Banner, Button, Card, DataTable, Field, Form, Heading, Input, Text } = usePrimitives();
  const dispatcher = useDispatcher();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<RoleOption>(inviteRoleOptions[0] ?? "User");
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [lastInvited, setLastInvited] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    const membersRes = await dispatcher.query<readonly MemberRow[]>(TenantQueries.members, {});
    if (!membersRes.isSuccess) {
      setState({ kind: "error", message: membersRes.error.message });
      return;
    }
    const invitationsRes = await dispatcher.query<readonly InvitationRow[]>(
      TenantQueries.invitations,
      {},
    );
    if (!invitationsRes.isSuccess) {
      setState({ kind: "error", message: invitationsRes.error.message });
      return;
    }
    setState({ kind: "ready", members: membersRes.data, invitations: invitationsRes.data });
  }, [dispatcher]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onInvite = (e?: React.FormEvent): void => {
    e?.preventDefault();
    void (async (): Promise<void> => {
      setActionError(null);
      setSubmitting(true);
      const email = inviteEmail.trim();
      const res = await dispatcher.write(AuthHandlers.inviteCreate, { email, role: inviteRole });
      setSubmitting(false);
      if (!res.isSuccess) {
        setActionError(res.error.message);
        return;
      }
      setLastInvited(email);
      setInviteEmail("");
      await refresh();
    })();
  };

  const onCancel = async (invitationId: string): Promise<void> => {
    setActionError(null);
    const res = await dispatcher.write(TenantHandlers.cancelInvitation, { invitationId });
    if (!res.isSuccess) {
      setActionError(res.error.message);
      return;
    }
    await refresh();
  };

  if (state.kind === "loading") {
    return (
      <FormScreenShell testId="members-screen">
        <Text variant="small">{t("tenant.members.loading")}</Text>
      </FormScreenShell>
    );
  }

  if (state.kind === "error") {
    return (
      <FormScreenShell testId="members-screen">
        <Banner variant="error">{state.message}</Banner>
      </FormScreenShell>
    );
  }

  const roleSelectOptions = inviteRoleOptions.map((r) => ({ value: r, label: r }));

  return (
    <FormScreenShell testId="members-screen" className="flex flex-col gap-6">
      <Heading variant="page">{t("tenant.members.title")}</Heading>

      <Card
        slots={{ title: `${t("tenant.members.active")} (${state.members.length})` }}
        options={{ padded: false }}
      >
        <DataTable
          testId="members-active-table"
          columns={[
            {
              field: "email",
              label: t("tenant.members.col.email"),
              type: "string",
              sortable: false,
            },
            {
              field: "roles",
              label: t("tenant.members.col.roles"),
              type: "string",
              sortable: false,
            },
          ]}
          rows={state.members.map((m) => ({
            id: m.id,
            values: {
              email: m.email ?? `${m.userId.slice(0, 8)}…`,
              roles: m.roles.join(", "),
            },
          }))}
        />
      </Card>

      <Form
        testId="invite-form"
        title={t("tenant.members.invite.title")}
        onSubmit={onInvite}
        actions={
          <Button
            type="submit"
            variant="primary"
            loading={submitting}
            disabled={submitting}
            testId="invite-submit"
          >
            {submitting ? t("tenant.members.invite.submitting") : t("tenant.members.invite.submit")}
          </Button>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="invite-email" label={t("tenant.members.invite.email")} required>
            <Input
              kind="email"
              id="invite-email"
              name="invite-email"
              value={inviteEmail}
              onChange={setInviteEmail}
              disabled={submitting}
              required
              autoComplete="email"
            />
          </Field>
          <Field id="invite-role" label={t("tenant.members.invite.role")} required>
            <Input
              kind="select"
              id="invite-role"
              name="invite-role"
              value={inviteRole}
              onChange={(v) => setInviteRole(v as RoleOption)}
              options={roleSelectOptions}
              disabled={submitting}
              required
            />
          </Field>
        </div>
        {lastInvited !== null && !submitting && (
          <Banner variant="info">
            {t("tenant.members.invite.success", { email: lastInvited })}
          </Banner>
        )}
        {actionError !== null && <Banner variant="error">{actionError}</Banner>}
      </Form>

      <Card
        slots={{ title: `${t("tenant.members.pending")} (${state.invitations.length})` }}
        options={{ padded: false }}
      >
        <DataTable
          testId="pending-list"
          columns={[
            {
              field: "email",
              label: t("tenant.members.col.email"),
              type: "string",
              sortable: false,
            },
            {
              field: "role",
              label: t("tenant.members.col.roles"),
              type: "string",
              sortable: false,
            },
            {
              field: "expires",
              label: t("tenant.members.col.expires"),
              type: "string",
              sortable: false,
            },
          ]}
          rows={state.invitations.map((inv) => ({
            id: inv.id,
            values: {
              email: inv.email,
              role: inv.role,
              expires: formatExpiresAt(inv.expiresAt),
            },
          }))}
          rowActions={[
            {
              id: "cancel",
              label: t("tenant.members.cancel"),
              style: "danger",
              onTrigger: (row) => void onCancel(row.id),
            },
          ]}
          rowActionMode="inline"
          emptyState={<Text variant="small">{t("tenant.members.pending.empty")}</Text>}
        />
      </Card>
    </FormScreenShell>
  );
}

function formatExpiresAt(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
