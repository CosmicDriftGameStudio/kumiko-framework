# @cosmicdrift/kumiko-document-designer

Client-side screens for the Kumiko document designer. Currently ships the PDF template editor.

```ts
import { documentDesignerClient } from "@cosmicdrift/kumiko-document-designer/web";

createKumikoApp({ clientFeatures: [documentDesignerClient("pdf-template-editor")] });
```

The registered custom screen reads the template from the URL: `?slug=invoice&locale=de`.
`PdfTemplateEditor` (props `slug`, `locale`, `onLocaleChange`) can also be mounted directly.

Requirements: the `template-resolver` and `renderer-puppeteer-client` features on the server.
A SystemAdmin (via `UserRolesProvider`) edits the system template, everyone else a tenant customisation.
PDF preview uses `pdfjs-dist` in the main thread (no worker or CDN requests).
