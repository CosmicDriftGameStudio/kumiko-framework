// @runtime client
// Single audit event detail. Route entityId = event-store id (bigint string).

import {
  formatWhen,
  useDispatcher,
  useNav,
  usePrimitives,
  useTranslation,
} from "@cosmicdrift/kumiko-renderer";
import { FormScreenShell } from "@cosmicdrift/kumiko-renderer-web";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { TenantQueries } from "../../tenant/constants";
import { ANONYMOUS_USER_ID, AuditQueries, SYSTEM_ACTOR_ID } from "../constants";

type AuditDetail = {
  readonly id: string;
  readonly aggregateId: string;
  readonly aggregateType: string;
  readonly type: string;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly payload: Record<string, unknown>;
  readonly metadata: Record<string, unknown>;
};

type MemberRow = {
  readonly userId: string;
  readonly email: string | null;
  readonly displayName: string | null;
};

type State =
  | { readonly kind: "loading" }
  | { readonly kind: "missing" }
  | { readonly kind: "error"; readonly message: string }
  | {
      readonly kind: "ready";
      readonly event: AuditDetail;
      /** Resolved member display string, or "" if unknown. System actor is
       *  flagged separately so the translated label is formed in render
       *  (avoids refetch on locale change — fw#2297). */
      readonly memberLabel: string;
      readonly isSystemActor: boolean;
    };

export function AuditLogDetailScreen(): ReactNode {
  const t = useTranslation();
  const { Banner, Card, Text } = usePrimitives();
  const dispatcher = useDispatcher();
  const nav = useNav();
  const eventId = nav.route?.entityId;
  const [state, setState] = useState<State>({ kind: "loading" });

  const load = useCallback(async (): Promise<void> => {
    if (eventId === undefined || eventId === "") {
      setState({ kind: "missing" });
      return;
    }
    setState({ kind: "loading" });
    const res = await dispatcher.query<AuditDetail | null>(AuditQueries.details, { id: eventId });
    if (!res.isSuccess) {
      setState({ kind: "error", message: res.error.message });
      return;
    }
    if (res.data === null) {
      setState({ kind: "missing" });
      return;
    }
    const event = res.data;
    if (event.createdBy === SYSTEM_ACTOR_ID) {
      setState({ kind: "ready", event, memberLabel: "", isSystemActor: true });
      return;
    }
    // Single-user filter — do not decrypt the whole tenant roster for one name.
    const membersRes = await dispatcher.query<readonly MemberRow[]>(TenantQueries.members, {
      userId: event.createdBy,
    });
    const member = membersRes.isSuccess
      ? membersRes.data.find((m) => m.userId === event.createdBy)
      : undefined;
    setState({
      kind: "ready",
      event,
      memberLabel: member ? (member.displayName ?? member.email ?? "") : "",
      isSystemActor: false,
    });
  }, [dispatcher, eventId]);

  // kumiko-lint-ignore no-raw-hooks Phase-3 conversion tracked in #2312
  useEffect(() => {
    void load();
  }, [load]);

  if (state.kind === "loading") {
    return (
      <FormScreenShell testId="audit-log-detail-screen" maxWidth="3xl">
        <Text variant="small">{t("audit.log.detail.loading")}</Text>
      </FormScreenShell>
    );
  }

  if (state.kind === "missing") {
    return (
      <FormScreenShell testId="audit-log-detail-screen" maxWidth="3xl">
        <Banner variant="error">{t("audit.log.detail.missing")}</Banner>
      </FormScreenShell>
    );
  }

  if (state.kind === "error") {
    return (
      <FormScreenShell testId="audit-log-detail-screen" maxWidth="3xl">
        <Banner variant="error">{state.message}</Banner>
      </FormScreenShell>
    );
  }

  const { event, memberLabel, isSystemActor } = state;
  const actorName = isSystemActor ? t("audit.log.actor.system") : memberLabel;

  return (
    <FormScreenShell
      testId="audit-log-detail-screen"
      maxWidth="3xl"
      className="flex flex-col gap-6"
    >
      <Card slots={{ title: event.type }}>
        <dl className="grid gap-3 text-sm">
          <div>
            <dt className="font-medium">{t("audit.log.col.when")}</dt>
            <dd data-testid="audit-detail-when">{formatWhen(event.createdAt)}</dd>
          </div>
          <div>
            <dt className="font-medium">{t("audit.log.col.aggregate")}</dt>
            <dd data-testid="audit-detail-aggregate">
              {event.aggregateType} / {event.aggregateId}
            </dd>
          </div>
          <div>
            <dt className="font-medium">{t("audit.log.col.actor")}</dt>
            <dd data-testid="audit-detail-actor">{actorName}</dd>
          </div>
          <div>
            <dt className="font-medium">{t("audit.log.detail.field.id")}</dt>
            <dd>
              <Text variant="code">{event.id}</Text>
            </dd>
          </div>
        </dl>
      </Card>

      <Card slots={{ title: t("audit.log.detail.payload") }}>
        <pre
          className="max-h-96 overflow-auto whitespace-pre-wrap break-all text-xs"
          data-testid="audit-detail-payload"
        >
          {JSON.stringify(event.payload, null, 2)}
        </pre>
      </Card>

      <Card slots={{ title: t("audit.log.detail.metadata") }}>
        <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all text-xs">
          {JSON.stringify(event.metadata, null, 2)}
        </pre>
      </Card>
    </FormScreenShell>
  );
}
