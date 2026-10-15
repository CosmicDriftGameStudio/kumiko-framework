# renderer-foundation

Plugin-Foundation für Renderer (HTML-Mail, PDF, Image). Plugins (`renderer-mail-html`, `renderer-puppeteer-client`) registrieren sich via `r.useExtension("renderer", "<name>", { kinds, render })`.

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
  createRendererMailHtmlFeature(), // Plugin: kind "mail"
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
  const renderer = foundation.createRendererForTenant({ tenantId, kind: "mail" });
  const result = await renderer.render(
    {
      kind: "mail",
      payload: { slug: "billing:notify:invoice-ready", locale: "de", variables: { name: "Frau Schmidt" } },
    },
    { db: ctx.db, registry: ctx.registry, tenantId, config: ctx.config },
  );
  // result.subject, result.html, result.text, result.previewText
}
```

Plugins ohne Service-Deps ignorieren den zweiten `ctx`-Parameter.

Mails einer `r.notification` rendert die Delivery selbst: `template` + `meta` an der Notification werden beim Boot gesät (`seedNotificationTemplates`) und über kind `"mail"` gerendert. Ohne `template` + `meta` scheitert der Versand über den Email-Channel.

## Plugin-Auswahl-Reihenfolge

1. Tenant-Override (Config-Key `rendererPluginByKind`, z.B. `{ "mail": "mail-html" }`)
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
    // ctx ist optional — nur nehmen wenn Service-Access nötig
    render: async (req, ctx) => {
      // ctx.db, ctx.registry, ctx.tenantId verfügbar
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
