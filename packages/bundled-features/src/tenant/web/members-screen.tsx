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
  const { Banner, Button, Card, Field, Form, Heading, Input, Text } = usePrimitives();
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
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="p-3">{t("tenant.members.col.userId")}</th>
              <th className="p-3">{t("tenant.members.col.roles")}</th>
            </tr>
          </thead>
          <tbody>
            {state.members.map((m) => (
              <tr key={m.id} className="border-b border-muted">
                <td className="p-3">
                  <Text variant="code">{m.userId}</Text>
                </td>
                <td className="p-3">{m.roles.join(", ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
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
          <Banner variant="info">{t("tenant.members.invite.success", { email: lastInvited })}</Banner>
        )}
        {actionError !== null && <Banner variant="error">{actionError}</Banner>}
      </Form>

      <Card
        slots={{ title: `${t("tenant.members.pending")} (${state.invitations.length})` }}
        options={{ padded: false }}
      >
        {state.invitations.length === 0 ? (
          <div className="p-6">
            <Text variant="small">{t("tenant.members.pending.empty")}</Text>
          </div>
        ) : (
          <table className="w-full text-sm" data-testid="pending-list">
            <thead>
              <tr className="border-b text-left">
                <th className="p-3">{t("tenant.members.col.email")}</th>
                <th className="p-3">{t("tenant.members.col.roles")}</th>
                <th className="p-3">{t("tenant.members.col.expires")}</th>
                <th className="p-3" />
              </tr>
            </thead>
            <tbody>
              {state.invitations.map((inv) => (
                <tr key={inv.id} data-invitation-id={inv.id}>
                  <td className="p-3">{inv.email}</td>
                  <td className="p-3">{inv.role}</td>
                  <td className="p-3">{formatExpiresAt(inv.expiresAt)}</td>
                  <td className="p-3">
                    <Button
                      type="button"
                      variant="danger"
                      onClick={() => void onCancel(inv.id)}
                      testId={`cancel-${inv.email}`}
                    >
                      {t("tenant.members.cancel")}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
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
