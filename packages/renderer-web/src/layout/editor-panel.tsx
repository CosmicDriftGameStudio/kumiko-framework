// EditorPanel — V.1.2: Right-side editor panel für Target-Dispatch.
// Wird sichtbar wenn ein TreeNode mit target angeklickt wird. Zeigt
// das passende Editor-Component aus dem Resolver-Registry, oder eine
// Fallback-Info wenn kein Resolver registriert ist.
// Siehe visual-tree.md V.1.2 + V.1.1-B.

import type { TargetRef } from "@cosmicdrift/kumiko-framework/engine";
import { X } from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import { subscribeTargetDispatches } from "./target-resolver-stub";

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
  const [target, setTarget] = useState<TargetRef | undefined>();

  useEffect(() => {
    const unsubscribe = subscribeTargetDispatches((t: TargetRef) => {
      setTarget(t);
    });
    return unsubscribe;
  }, []);

  const handleClose = useCallback(() => {
    setTarget(undefined);
  }, []);

  if (target === undefined) return null;

  return (
    <div
      data-kumiko-layout="editor-panel"
      className="fixed inset-y-0 right-0 z-50 w-[480px] max-w-[90vw] border-l bg-background shadow-xl overflow-y-auto"
    >
      <EditorPanelInner target={target} resolvers={resolvers} onClose={handleClose} />
    </div>
  );
}
