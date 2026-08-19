// Bare content shell for hosting self-contained widgets (own submit/cancel
// buttons) in a slide-in side panel — same "no footer buttons of its own"
// contract as DefaultModal, delegating to the richer widgets/drawer.tsx
// Drawer (resize/backdrop/side are widget-only concerns, not exposed
// through the platform-neutral CorePrimitives.Drawer contract).

import type { DrawerProps } from "@cosmicdrift/kumiko-renderer";
import type { ReactNode } from "react";
import { Drawer } from "../widgets/drawer";

export function DefaultDrawer({
  open,
  onOpenChange,
  title,
  children,
  testId,
}: DrawerProps): ReactNode {
  return (
    <Drawer open={open} onOpenChange={onOpenChange} title={title} testId={testId}>
      {/* React re-parents portal content into the enclosing React tree for
          event bubbling (it only escapes the DOM tree, not the fiber tree) —
          without stopping it here, submitting the hosted actionForm would
          also bubble into an ancestor <form>'s onSubmit if the drawer was
          opened from inside one (same fix as DefaultModal, fw#1681). */}
      <div onSubmit={(e) => e.stopPropagation()}>{children}</div>
    </Drawer>
  );
}
