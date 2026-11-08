import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import { usePageHeaderSlotAvailable } from "../page-header-slot.ts";
import { usePrimitives } from "../primitives.tsx";

// The route still names the locked screen; its breadcrumb must not label what stands in for it.
// With a stand-in the header is labelled with that screen instead, none if it has no title.
function LockedScreenHeader({ standInScreenId }: { readonly standInScreenId?: string }): ReactNode {
  const { PageHeader } = usePrimitives();
  const pageHeaderSlotAvailable = usePageHeaderSlotAvailable();
  if (PageHeader === undefined || !pageHeaderSlotAvailable) return null;
  return standInScreenId !== undefined ? (
    <PageHeader hideBreadcrumb breadcrumbScreenId={standInScreenId} />
  ) : (
    <PageHeader hideBreadcrumb />
  );
}

type StandIn = { readonly screenId: string | undefined };

// A stand-in can itself be locked and fall back again. The header slot is a single value that
// every mounted PageHeader overwrites and clears on unmount, so only the outermost scope mounts
// a header; nested scopes report the screen that finally renders up to it.
const ReportStandInContext = createContext<((standIn: StandIn | undefined) => void) | undefined>(
  undefined,
);

// Separate from ReportStandInContext: the stand-in's own KumikoScreen wraps its body in a
// StandInChainBoundary, which clears the report context, so that one cannot tell a body it is a stand-in.
const StandInScreenContext = createContext(false);

/** Screen bodies (and anything embedded in them) are not part of a fallback chain. */
export function StandInChainBoundary({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    <ReportStandInContext.Provider value={undefined}>{children}</ReportStandInContext.Provider>
  );
}

export function LockedHeaderScope({
  standInScreenId,
  children,
}: {
  readonly standInScreenId?: string;
  readonly children?: ReactNode;
}): ReactNode {
  const reportToOuter = useContext(ReportStandInContext);
  const [inner, setInner] = useState<StandIn | undefined>(undefined);
  const effectiveScreenId = inner !== undefined ? inner.screenId : standInScreenId;

  useEffect(() => {
    if (reportToOuter === undefined) return;
    reportToOuter({ screenId: effectiveScreenId });
    return () => reportToOuter(undefined);
  }, [reportToOuter, effectiveScreenId]);

  return (
    <>
      {reportToOuter === undefined && (
        <LockedScreenHeader
          {...(effectiveScreenId !== undefined && { standInScreenId: effectiveScreenId })}
        />
      )}
      <StandInScreenContext.Provider value={standInScreenId !== undefined}>
        <ReportStandInContext.Provider value={setInner}>{children}</ReportStandInContext.Provider>
      </StandInScreenContext.Provider>
    </>
  );
}

/** True while the screen renders as the stand-in of a locked screen (`visibleWhen` + `fallback`). */
export function useIsStandInScreen(): boolean {
  return useContext(StandInScreenContext);
}
