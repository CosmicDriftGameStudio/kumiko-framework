# renderer-foundation

Plugin-Foundation für Renderer (Notification, HTML-Mail, PDF, Image). Plugins (`renderer-simple`, `renderer-mail-html`, `renderer-puppeteer-client`) registrieren sich via `r.useExtension("renderer", "<name>", { kinds, render })`.

**Plan-Doc:** [`kumiko-platform/docs/plans/features/renderer-foundation.md`](../../../../../../kumiko-platform/docs/plans/features/renderer-foundation.md)

## Mount

```typescript
import {
  collectRendererPlugins,
  createRendererFoundationApi,
  createRendererFoundationFeature,
} from "@cosmicdrift/kumiko-bundled-features/renderer-foundation";

const features = [
  createTemplateResolverFeature(),
  createRendererFoundationFeature(),
  createRendererSimpleFeature(),   // Plugin
  createRendererMailHtmlFeature(), // Plugin (enterprise)
  // weitere Plugins...
];

const app = createKumikoApp({
  features,
  extraContext: ({ registry }) => ({
    rendererFoundation: createRendererFoundationApi(
      collectRendererPlugins(registry),
    ),
  }),
});
```

## Konsumtion

```typescript
import { requireRendererFoundation } from "@cosmicdrift/kumiko-bundled-features/renderer-foundation";

async function sendMail(ctx, tenantId) {
  const foundation = requireRendererFoundation(ctx, "sendMail");
  const renderer = foundation.createRendererForTenant({ tenantId, kind: "mail-html" });
  const result = await renderer.render({
    kind: "mail-html",
    payload: { content: "Hello {{name}}", contentFormat: "markdown", variables: { name: "Frau Schmidt" } },
  });
  // result.html, result.text
}
```

## Plugin-Auswahl-Reihenfolge

1. Tenant-Override (Config-Key `rendererPluginByKind`, z.B. `{ "mail-html": "mail-html" }`)
2. `DEFAULT_PLUGIN_BY_KIND` aus constants
3. Erstes Plugin im Pool das das kind bedient
4. `RendererError("no_plugin_for_kind")` wenn nichts passt

## Eigenes Plugin schreiben

```typescript
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";

export const myRendererFeature = defineFeature("renderer-myown", (r) => {
  r.requires("renderer-foundation");
  r.useExtension("renderer", "myown", {
    kinds: ["document-pdf"],
    render: async (req) => {
      // eigene PDF-Logik
      return { kind: "document-pdf", pdfBytes: ..., pageCount: 1, sizeBytes: ... };
    },
  });
});
```

## Out-of-Scope

- Template-Storage (kommt aus `template-resolver`)
- Resource-URL-Substitution (Caller-Verantwortung: signed-URL vs. data-URI je nach kind)
- Template-Authoring-UI — `designer`-Bundle (geplant)
- Mail-Versand — `delivery` + `mail-transport-smtp`
