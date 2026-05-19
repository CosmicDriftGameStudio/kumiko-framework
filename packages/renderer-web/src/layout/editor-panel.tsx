// EditorPanel — V.1.2: Main-area editor für Target-Dispatch im
// Visual-Tree-Workspace. VS-Code-Style-Layout: Tree links, Editor füllt
// den Main-Bereich; kein floating-Right-Panel. Resolver liefert die
// Editor-Component für `${featureId}:${action}`, Fallback-Info zeigt
// die Args wenn nichts registriert ist, Empty-State wenn nichts gewählt.
//
// **V.1.4b URL-State**: target wird in `nav.searchParams` persistiert
// (Format: `?t=text-content:edit&a_slug=imprint&a_lang=de`). F5 +
// Back-Button stellen den Editor-State wieder her. Single source of
// truth = URL; useState fällt weg. Close clears params via setSearchParams.
// Subscribe-Stream bleibt für Test-Hooks (setDispatchListener), wird
// in Prod nicht mehr für EditorPanel benutzt.
// Siehe visual-tree.md V.1.2 + V.1.1-B + V.1.4b.

import type { TargetRef } from "@cosmicdrift/kumiko-framework/engine";
import { useNav } from "@cosmicdrift/kumiko-renderer";
import { X } from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import { useCallback, useMemo } from "react";
import { clearTargetSearchParams, parseTargetFromSearchParams } from "./target-url";

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
          aria-label="close editor"
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
        <pre className="bg-muted p-2 rounded text-xs overflow-auto">
          {JSON.stringify(target.args, null, 2)}
        </pre>
      </div>
    </div>
  );
}

export function EditorPanel({ resolvers }: EditorPanelProps): ReactNode {
  const nav = useNav();
  // target derived from URL → F5/Back stellen state wieder her.
  // useMemo stabilisiert reference solange searchParams shallow-gleich
  // sind (nav-Impl liefert plain-record für genau diesen check).
  const target = useMemo(() => parseTargetFromSearchParams(nav.searchParams), [nav.searchParams]);

  const handleClose = useCallback(() => {
    nav.setSearchParams(clearTargetSearchParams(nav.searchParams));
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
