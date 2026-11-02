import type { ReactNode } from "react";

export type PreviewDevice = "desktop" | "mobile";

// Page widths of a rendered preview live here, inside the Tailwind scan surface, so feature code
// picks a device instead of carrying its own max-w classes.
const PREVIEW_WIDTH_CLASS: Readonly<Record<PreviewDevice, string>> = {
  desktop: "mx-auto w-full max-w-[760px]",
  mobile: "mx-auto w-full max-w-[375px]",
};

export function PreviewWidthFrame({
  device,
  children,
  testId,
}: {
  readonly device: PreviewDevice;
  readonly children: ReactNode;
  readonly testId?: string;
}): ReactNode {
  return (
    <div className={PREVIEW_WIDTH_CLASS[device]} data-testid={testId} data-device={device}>
      {children}
    </div>
  );
}
