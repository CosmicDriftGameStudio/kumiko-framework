# renderer-foundation

Plugin foundation for renderers (HTML email, PDF, image). Plugins (`renderer-mail-html`, `renderer-puppeteer-client`) register via `r.useExtension("renderer", "<name>", { kinds, render })`.

## Mount

```typescript
import { createRendererFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/renderer-foundation";

const features = [
  createTemplateResolverFeature(),
  createRendererFoundationFeature(),
  createRendererMailHtmlFeature(), // Plugin: kind "mail"
  // more plugins...
];
```

## Consumption

```typescript
import {
  collectRendererPlugins,
  selectRendererPlugin,
} from "@cosmicdrift/kumiko-bundled-features/renderer-foundation";

async function sendMail(ctx, tenantId) {
  const renderer = selectRendererPlugin(collectRendererPlugins(ctx.registry), "mail");
  const result = await renderer.render(
    {
      kind: "mail",
      payload: {
        slug: "billing:notify:invoice-ready",
        locale: "de",
        variables: { name: "Frau Schmidt" },
      },
    },
    { db: ctx.db, registry: ctx.registry, tenantId, config: ctx.config },
  );
  // result.subject, result.html, result.text, result.previewText
}
```

Plugins without service dependencies ignore the second `ctx` parameter.

Emails from an `r.notification` are rendered by the delivery itself: `template` and `meta` on the notification are seeded at boot (`seedNotificationTemplates`) and rendered with kind `"mail"`. Without `template` and `meta`, sending through the email channel fails.

## Plugin Selection Order

1. the plugin named in `DEFAULT_PLUGIN_BY_KIND` (mail → mail-html, document-pdf and image-snapshot → puppeteer) when it is mounted
2. the first mounted plugin that serves the kind
3. `RendererError("no_plugin_for_kind")`

There is no per-tenant choice. Every kind has one payload contract, so a plugin that serves a kind must accept that kind's payload.

## Writing a Custom Plugin

```typescript
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";

export const myRendererFeature = defineFeature("renderer-myown", (r) => {
  r.requires({ features: ["renderer-foundation"] });
  r.useExtension("renderer", "myown", {
    kinds: ["document-pdf"],
    // ctx is optional, only use it when service access is required
    render: async (req, ctx) => {
      // ctx.db, ctx.registry, ctx.tenantId available
      // custom PDF logic
      return { kind: "document-pdf", pdfBytes: ..., pageCount: 1, sizeBytes: ... };
    },
  });
});
```

## Out of Scope

- Template storage (provided by `template-resolver`)
- Resource URL substitution (caller's responsibility: signed URL versus data URI depending on the kind)
- Template authoring UI, `designer` bundle (planned)
- Email delivery, `delivery` + `mail-transport-smtp`
