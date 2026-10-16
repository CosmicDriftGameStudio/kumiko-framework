---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-document-designer": minor
---

Template overview and layout editor

<!-- kumiko-changes
feature: template-resolver
type: improvement
title: Overview and layout-source queries for the template designer
detail: template-resolver:query:overview lists the mail, PDF and layout templates of the caller's tenant grouped by slug and kind (effective origin, locales, status, versions, layout slug, last change and the notifications that use it) and template-resolver:query:layout-source returns the header, signature and footer regions of a mail or PDF layout plus the locale a save has to use; a SystemAdmin also receives the MJML source of the system layout. The usage lookup is the exported collectTemplateUsage.
-->

<!-- kumiko-changes
feature: managed-pages
type: improvement
title: Branding screen edits the logo file and readBranding returns logoFile
detail: The branding settings screen has a logo upload for managed-pages:config:branding-logo-file, and readBranding and the branding query include logoFile next to logoUrl. The template resource errors template_resource_too_large and template_resource_unsupported_image have German and Spanish texts.
-->

<!-- kumiko-changes
feature: admin-shell
type: improvement
title: includeDocumentDesigner lists the template navs in the admin workspaces
detail: With includeDocumentDesigner, the tenant workspace shows document-designer:nav:templates and the platform workspace document-designer:nav:platform-templates. The option requires the document-designer feature and defaults to false.
-->

<!-- kumiko-changes
feature: document-designer
type: improvement
title: Template overview, layout editor and an options object for documentDesignerClient
detail: The package gains the server feature createDocumentDesignerFeature with the templates and platform-templates overviews and the layout-editor screen. documentDesignerClient now takes an options object instead of a screen id, and appLocales sets the languages column of the overview. The feature declares the pdf-template-editor screen (PDF_TEMPLATE_EDITOR_SCREEN_ID) and PDF rows open the PDF editor.
-->
