import type { ReactNode } from "react";

/** Side panel hosting a self-contained form or detail without leaving the underlying screen: a
 *  `kind: "drawer"` action mounts an actionForm or a projectionDetail here instead of a full page.
 *  Same bare content shell as `Modal` (no footer buttons of its own), slide-in instead of overlay. */
export type DrawerProps = {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title?: string;
  /** Muted line under the title. */
  readonly subtitle?: string;
  /** `"wide"` asks for a broad panel (1280px, capped at 85vw); `"popup"` fills the viewport minus a 24px margin on the web; default is the standard panel width. */
  readonly width?: "wide" | "popup";
  /** No visible title bar: the title stays for assistive tech and the close cross floats top right, because the hosted content brings its own header. */
  readonly headerless?: true;
  /** Escape pressed while open: return true to consume it, so the drawer stays open. */
  readonly onEscapeKey?: () => boolean;
  /** Header shows a back arrow left of the title instead of the close cross; it only closes this drawer. */
  readonly back?: true;
  readonly children: ReactNode;
  readonly testId?: string;
};
