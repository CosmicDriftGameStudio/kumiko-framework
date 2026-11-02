import type { PreviewRenderer, PreviewRendererProps } from "@cosmicdrift/kumiko-renderer";
import type { ClientFeatureDefinition } from "@cosmicdrift/kumiko-renderer/web";
import type { ReactNode } from "react";

// A custom renderer for one preview target. The editor workbench hands it the draft content, the
// example variables and what is being edited; it decides how that looks. This one shows the body
// inside the shop's own page chrome instead of the framework's plain web frame.
const BrandedWebPreview: PreviewRenderer = ({ content }: PreviewRendererProps): ReactNode => (
  <article data-testid="branded-preview" className="mx-auto max-w-[680px] border p-8">
    <header className="mb-4 font-semibold tracking-wide">Acme Hardware</header>
    <div data-testid="branded-preview-body" className="whitespace-pre-wrap">
      {content}
    </div>
  </article>
);

// Registered next to managedPagesClient(): the later client feature wins the "web" target, and
// createKumikoApp logs the replacement once at boot.
export function brandedPreviewClient(): ClientFeatureDefinition {
  return { name: "acme-branded-preview", contentPreviews: { web: BrandedWebPreview } };
}
