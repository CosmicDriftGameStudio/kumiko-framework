// EditorPanel: Main-area editor for target dispatch in the
// visual-tree workspace. VS Code-style layout: tree on the left, editor fills
// the main area; no floating right panel. The resolver provides the editor
// component for `${featureId}:${action}`; fallback information shows the
// args when nothing is registered, and an empty state appears when nothing is selected.
//
// **URL state**: target is persisted in `nav.searchParams`
// (format: `?t=text-content:edit&a_slug=imprint&a_lang=de`). F5 and
// the Back button restore the editor state. The URL is the single source of
// truth, so useState is unnecessary. Closing clears the params via setSearchParams.
// The subscribe stream remains available for test hooks (setDispatchListener),
// but is no longer used by EditorPanel in production.

import type { TargetRef } from "@cosmicdrift/kumiko-framework/engine";
import { X } from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import { useCallback, useMemo } from "react";
import { requestLeave, useNav, usePrimitives, useTranslation } from "../../index.ts";
import { clearTargetSearchParams, parseTargetFromSearchParams } from "./target-url.ts";

export type ResolverComponent = ComponentType<{
  readonly target: TargetRef;
  readonly onClose: () => void;
}>;

export type EditorPanelProps = {
  readonly resolvers: ReadonlyMap<string, ResolverComponent>;
};

function EditorPanelInner({
  target,
  resolvers,
  onClose,
}: {
  readonly target: TargetRef;
  readonly resolvers: ReadonlyMap<string, ResolverComponent>;
  readonly onClose: () => void;
}): ReactNode {
  const { JsonView } = usePrimitives();
  const t = useTranslation();
  const resolverKey = `${target.featureId}:${target.action}`;
  const Resolver = resolvers.get(resolverKey);

  if (Resolver !== undefined) {
    return <Resolver target={target} onClose={onClose} />;
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Editor</h2>
        <button
          type="button"
          aria-label={t("kumiko.dialog.close")}
          className="p-1 hover:bg-accent rounded"
          onClick={onClose}
        >
          <X className="size-4" />
        </button>
      </div>
      <div className="text-sm text-muted-foreground space-y-2">
        <p>
          Kein Editor f&uuml;r{" "}
          <code>
            {target.featureId}:{target.action}
          </code>{" "}
          registriert.
        </p>
        {JsonView !== undefined ? (
          <JsonView value={target.args} />
        ) : (
          <pre className="bg-muted p-2 rounded text-xs overflow-auto">
            {JSON.stringify(target.args, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}

export function EditorPanel({ resolvers }: EditorPanelProps): ReactNode {
  const nav = useNav();
  // target is derived from the URL, so F5 and Back restore the state.
  // useMemo keeps the reference stable while searchParams are shallow-equal
  // (the nav implementation provides a plain record for this check).
  const target = useMemo(() => parseTargetFromSearchParams(nav.searchParams), [nav.searchParams]);

  const handleClose = useCallback(() => {
    requestLeave(() => nav.setSearchParams(clearTargetSearchParams(nav.searchParams)));
  }, [nav]);

  return (
    <div data-kumiko-layout="editor-main" className="flex-1 overflow-y-auto">
      {target === undefined ? (
        <EditorEmptyState />
      ) : (
        <EditorPanelInner target={target} resolvers={resolvers} onClose={handleClose} />
      )}
    </div>
  );
}

function EditorEmptyState(): ReactNode {
  return (
    <div className="flex h-full items-center justify-center p-8 text-sm text-muted-foreground">
      <p>W&auml;hle einen Knoten links zum Bearbeiten.</p>
    </div>
  );
}
