import type {
  ScreenFallback,
  ScreenFallbackReason,
  ScreenVisibility,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { fallbackTargetFor } from "@cosmicdrift/kumiko-types/screen";
import { type ReactNode, useEffect, useRef } from "react";
import type { Translate } from "../headless/index.ts";
import { type UseQueryResult, useQuery } from "../hooks/use-query.ts";
import { useTranslation } from "../i18n.tsx";
import { usePrimitives } from "../primitives.tsx";
import { LockedHeaderScope } from "./locked-screen-header.tsx";
import { QueryErrorBanner, QueryLoadingBanner } from "./query-state-banners.tsx";
import {
  evalVisibleWhenAfterShown,
  type FailedVerdict,
  screenFallbackReason,
} from "./visible-when.ts";

type NoticeKey = "kumiko.screen.unavailable" | "kumiko.screen.forbidden" | "kumiko.screen.notFound";

export function ScreenNotice({
  messageKey = "kumiko.screen.unavailable",
}: {
  readonly messageKey?: NoticeKey;
}): ReactNode {
  const { Banner } = usePrimitives();
  const t = useTranslation();
  return (
    <Banner padded variant="info" testId="kumiko-screen-unavailable">
      {t(messageKey)}
    </Banner>
  );
}

export function LockedNotice({ messageKey }: { readonly messageKey?: NoticeKey }): ReactNode {
  return (
    <>
      <LockedHeaderScope />
      <ScreenNotice {...(messageKey !== undefined && { messageKey })} />
    </>
  );
}

// Only the map form gets reason-specific defaults; a plain string or no fallback keeps the
// single "unavailable" notice. `error` renders a retry banner instead, so its entry is a
// safety net for an error verdict that carries no error object.
const DEFAULT_NOTICE_KEY: Record<ScreenFallbackReason, NoticeKey> = {
  hidden: "kumiko.screen.unavailable",
  forbidden: "kumiko.screen.forbidden",
  notFound: "kumiko.screen.notFound",
  error: "kumiko.screen.unavailable",
};

export function ScreenVisibilityGate({
  entityId,
  visibleWhen,
  fallback,
  translate,
  renderFallbackScreen,
  children,
}: {
  readonly entityId: string | undefined;
  readonly visibleWhen: ScreenVisibility;
  readonly fallback: ScreenFallback | undefined;
  readonly translate?: Translate;
  readonly renderFallbackScreen: (target: string, entityId: string | undefined) => ReactNode;
  readonly children: ReactNode;
}): ReactNode {
  // An idParam gate without a route id has nothing to ask: treated as hidden, never queried.
  const missingRouteId = visibleWhen.idParam !== undefined && entityId === undefined;
  const result = useQuery<Readonly<Record<string, unknown>>>(
    visibleWhen.query,
    visibleWhen.idParam !== undefined && entityId !== undefined
      ? { [visibleWhen.idParam]: entityId }
      : {},
    { live: true, enabled: !missingRouteId },
  );
  const wasShown = useRef(false);
  const verdict = missingRouteId
    ? "hidden"
    : evalVisibleWhenAfterShown(visibleWhen, result, wasShown.current);
  useEffect(() => {
    if (verdict === "visible") wasShown.current = true;
  }, [verdict]);
  if (verdict === "visible") return children;
  if (verdict === "loading") {
    return <QueryLoadingBanner />;
  }
  return (
    <ClosedGate
      verdict={verdict}
      result={result}
      fallback={fallback}
      translate={translate}
      renderFallbackScreen={(target) =>
        renderFallbackScreen(
          target,
          visibleWhen.idParam !== undefined && entityId !== undefined ? entityId : undefined,
        )
      }
    />
  );
}

function ClosedGate({
  verdict,
  result,
  fallback,
  translate,
  renderFallbackScreen,
}: {
  readonly verdict: FailedVerdict;
  readonly result: UseQueryResult<Readonly<Record<string, unknown>>>;
  readonly fallback: ScreenFallback | undefined;
  readonly translate?: Translate;
  readonly renderFallbackScreen: (target: string) => ReactNode;
}): ReactNode {
  const t = useTranslation();
  const reason = screenFallbackReason(verdict, result.error);
  const target = fallback === undefined ? undefined : fallbackTargetFor(fallback, reason);
  if (target !== undefined) return renderFallbackScreen(target);
  if (typeof fallback !== "object") return <LockedNotice />;
  if (reason === "error" && result.error) {
    return (
      <>
        <LockedHeaderScope />
        <QueryErrorBanner
          error={result.error}
          translate={translate ?? t}
          onRetry={result.refetch}
        />
      </>
    );
  }
  return <LockedNotice messageKey={DEFAULT_NOTICE_KEY[reason]} />;
}
