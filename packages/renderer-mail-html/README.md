# renderer-mail-html

Plugin für `renderer-foundation`. Rendert `RenderRequest { kind: "mail" }` zu Betreff + Email-safe HTML + plain-text: **Mail-Template (Dokument-HTML + `meta.subject`) -> isolierter Handlebars -> MJML-Layout -> html-to-text**.

## Pipeline

```
RenderRequest { kind: "mail", payload: { slug, locale, variables, unsubscribeUrl? } }
                            ↓
   1. Template laden      resolveTemplate(slug, kind "mail", locale), nur contentFormat html,
                          meta.subject Pflicht
   2. Layout laden        meta.layoutSlug ?? "default", kind "mail-layout";
                          tenant -> system -> in-code DEFAULT_MAIL_LAYOUT_MJML
   3. Body kompilieren    compileDocumentBodyToHandlebars (template-resolver): span[data-variable],
                          Links, Listenzeilen -> Handlebars-Quelle; Autoren-Klammern sind inert
   4. Rendern             Handlebars.create() mit Helfern money/date/link, HTML-Escaping an;
                          Betreff + Preview-Text ohne Escaping, CR/LF entfernt
   5. Layout              Body als Datum (`{{{content}}}`), nie in die Layout-Quelle konkateniert;
                          Layout-Kontext nur: content, subject, previewText, tenantName,
                          signature, imprint, unsubscribeUrl
   6. mjml + html-to-text
                            ↓
   RenderResponse { kind: "mail", subject, html, text, previewText? }
```

Datum und Zahlen formatiert der Renderer nach `payload.locale`, der Sprache der Vorlage, im langen Datumsformat („1. Oktober 2026“). `ctx.config` (optional) liefert die Währung (tenant-settings) und `tenantName` (Branding-Titel); ohne Config gelten `EUR` und `""`.

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
```

Mail-Texte kommen aus `r.notification({ variables, template, meta })`; `applyBootSeeds` legt sie als System-Templates an.

## Caller-Pattern

```typescript
const foundation = requireRendererFoundation(ctx, "sendWelcomeMail");
const renderer = foundation.createRendererForTenant({ tenantId, kind: "mail" });

const result = await renderer.render(
  {
    kind: "mail",
    payload: {
      slug: "my-feature:notify:welcome",
      locale: "de",
      variables: { name: user.name, verifyUrl: "https://..." },
    },
  },
  { db: ctx.db, registry: ctx.registry, tenantId, config: ctx.config },
);

await ctx.mailTransport.send({ to: user.email, subject: result.subject, html: result.html, text: result.text });
```

## Tenant-Branding

Ein Tenant legt ein eigenes Layout als Template `kind: "mail-layout"`, `contentFormat: "mjml"`, Slug `default` (oder den Slug aus `meta.layoutSlug`) an. Es gewinnt gegen System-Layout und in-code Default. Das Layout sieht nur die oben genannten Variablen; den Body setzt es mit `{{{content}}}` ein.

## Optionales Seeding

```typescript
import { seedSystemMailLayout } from "@cosmicdrift/kumiko-renderer-mail-html/seeding";

await seedSystemMailLayout(db); // idempotent
```

Ohne Seeding läuft das Plugin trotzdem und fällt auf `DEFAULT_MAIL_LAYOUT_MJML` zurück.

## Out-of-Scope

- Visual-Editor für Layouts
- Inline-Image-Embedding (CID-Attachments)
- PDF/Image -> andere Plugins (`renderer-puppeteer-client`)
- Mail-Versand -> `delivery` + `channel-email` + `mail-transport-*`
