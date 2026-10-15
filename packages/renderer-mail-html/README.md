# renderer-mail-html

Plugin für `renderer-foundation`. Rendert `RenderRequest { kind: "mail-html" }` zu Email-safe HTML + plain-text via **MJML-Layout + Markdown-Content + Handlebars + html-to-text**.

**Plan-Doc:** [`kumiko-platform/docs/plans/features/renderer-mail-html.md`](https://github.com/CosmicDriftGameStudio/kumiko-platform/blob/main/docs/plans/features/renderer-mail-html.md)

## Pipeline

```
RenderRequest { kind: "mail-html", payload: { content, variables, locale? } }
                            ↓
   1. Resolve Layout      (template-resolver, 4-stage fallback)
        tenant×"mail-layout" → system×"mail-layout"
        → in-code DEFAULT_MAIL_LAYOUT_MJML (wenn nichts in DB)
                            ↓
   2. Handlebars(content, variables)    → Markdown mit ersetzten {{vars}}
   3. marked(markdown)                  → Content-HTML (p/h1/a/ul/...)
   4. Handlebars(layout, { ...vars, content: contentHtml })
                                         → MJML mit Content im {{{content}}}-Slot
   5. mjml(...)                         → Email-safe HTML (tables, inline-CSS)
   6. html-to-text(html)                → text/plain-Alternative
                            ↓
   RenderResponse { kind: "mail-html", html, text }
```

## Mount

```typescript
import { createRendererMailHtmlFeature } from "@cosmicdrift/kumiko-renderer-mail-html";
import { createTemplateResolverFeature } from "@cosmicdrift/kumiko-bundled-features/template-resolver";
import { createRendererFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/renderer-foundation";

const features = [
  createTemplateResolverFeature(),    // Vorausgesetzt
  createRendererFoundationFeature(),  // Vorausgesetzt
  createRendererMailHtmlFeature(),    // Dieses Plugin
];

const app = createKumikoApp({
  features,
  extraContext: ({ db, registry }) => ({
    rendererFoundation: createRendererFoundationApi(collectRendererPlugins(registry)),
  }),
});
```

## Caller-Pattern

```typescript
import { requireRendererFoundation } from "@cosmicdrift/kumiko-bundled-features/renderer-foundation";

async function sendWelcomeMail(ctx, tenantId, user) {
  // 1. Foundation findet Plugin
  const foundation = requireRendererFoundation(ctx, "sendWelcomeMail");
  const renderer = foundation.createRendererForTenant({ tenantId, kind: "mail-html" });

  // 2. Caller löst Content-Template VORHER auf (Plugin macht das NICHT)
  const contentTpl = await ctx.templateResolver.resolveTemplate({
    tenantId,
    slug: "notification.welcome",
    kind: "mail-html",
    locale: "en",
  });

  // 3. Render
  const result = await renderer.render(
    {
      kind: "mail-html",
      payload: {
        content: contentTpl.content,
        contentFormat: contentTpl.contentFormat,
        variables: { name: user.name, verifyUrl: "...", appName: "MyApp" },
        locale: "en",
      },
    },
    { db: ctx.db, registry: ctx.registry, tenantId },
  );

  // 4. result.html + result.text → mail-transport
  await ctx.mailTransport.send({
    to: user.email,
    subject: "Willkommen!",
    html: result.html,
    text: result.text,
  });
}
```

## Tenant-Branding

Tenant kann ein eigenes `"mail-layout"`-Template anlegen (kind=mail-html, format=mjml). 4-stage-fallback bevorzugt das gegenüber System + in-code Default:

```typescript
// Via template-resolver-Dispatcher (z.B. Admin-UI):
await ctx.dispatch("template-resolver:upsertTenantTemplate", {
  slug: "mail-layout",
  kind: "mail-html",
  locale: "en",
  content: `<mjml>
    <mj-body bg-color="{{brandColor}}">
      ...
      <mj-raw>{{{content}}}</mj-raw>
      ...
    </mj-body>
  </mjml>`,
  contentFormat: "mjml",
});
```

## Default-Layout-Variablen

| Variable | Zweck | Pflicht |
|---|---|---|
| `appName` | Header + Footer-Text | empfohlen |
| `content` | Auto-injected vom Plugin (Content-HTML) | nein (intern) |
| `unsubscribeUrl` | Footer-Link, nur wenn gesetzt | optional |

Per-Content-Vars (z.B. `name`, `verifyUrl`) kommen aus `payload.variables` und sind sowohl im Content als auch im Layout zugänglich.

## Optionales Seeding

Bundle exportiert `seedSystemMailLayout(db)` für App-Authors, die das Default-Layout im Admin-UI editierbar machen wollen:

```typescript
import { seedSystemMailLayout } from "@cosmicdrift/kumiko-renderer-mail-html/seeding";

// Beim App-Setup, einmalig:
await seedSystemMailLayout(stack.db);
```

Ohne Seeding läuft Plugin trotzdem — fällt auf in-code `DEFAULT_MAIL_LAYOUT_MJML`-Constant zurück.

## Out-of-Scope

- Visual-Editor für Layouts → kommt mit `designer`-Bundle
- Inline-Image-Embedding (CID-Attachments) → vermutlich am `delivery`-Layer
- PDF/Image → andere Plugins (`renderer-puppeteer-client`)
- Mail-Versand → `delivery` + `channel-email` + `mail-transport-*`
