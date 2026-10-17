// @runtime client
// Default translation bundle for the text-block editor. textBlocksClient()
// hangs it into the LocaleProvider as a fallback bundle — apps override
// individual keys via mergeTranslations at the createKumikoApp level.
//
// Keys follow `template-resolver.editor.<slug>`.

import type { TranslationsByLocale } from "@cosmicdrift/kumiko-renderer";

export const defaultTranslations: TranslationsByLocale = {
  en: {
    "template-resolver.documentEditor.button": "Button",
    "template-resolver.documentEditor.buttonDefaultText": "Confirm",
    "template-resolver.documentEditor.buttonTarget": "Button target",
    "template-resolver.documentEditor.buttonText": "Button text",
    "template-resolver.documentEditor.cancel": "Cancel",
    "template-resolver.documentEditor.divider": "Divider",
    "template-resolver.documentEditor.heading3": "Heading 3",
    "template-resolver.documentEditor.image": "Image",
    "template-resolver.documentEditor.imageBlock": "Image · inline",
    "template-resolver.documentEditor.imageAlt": "Alt text (optional)",
    "template-resolver.documentEditor.insert": "Insert",
    "template-resolver.documentEditor.insertPlaceholder": "Placeholder",
    "template-resolver.documentEditor.invalidImageAlt": "The alt text must not contain < or >.",
    "template-resolver.documentEditor.invalidLink":
      "This link target is not allowed. Use https, http, mailto, tel or a placeholder.",
    "template-resolver.documentEditor.invalidResourceKey": "This resource key is not valid.",
    "template-resolver.documentEditor.link": "Link",
    "template-resolver.documentEditor.linkHref": "Link target",
    "template-resolver.documentEditor.linkHrefPlaceholder": "https://",
    "template-resolver.documentEditor.noVariables": "No matching variables are available here.",
    "template-resolver.documentEditor.pageBreak": "Page break",
    "template-resolver.documentEditor.align": "Align",
    "template-resolver.documentEditor.alignLeft": "Left",
    "template-resolver.documentEditor.alignCenter": "Centered",
    "template-resolver.documentEditor.alignRight": "Right",
    "template-resolver.documentEditor.alignJustify": "Justified",
    "template-resolver.documentEditor.repeatBarList": "Repeat · {list}",
    "template-resolver.documentEditor.repeatHeader": "Repeat header row",
    "template-resolver.documentEditor.paragraph": "Paragraph",
    "template-resolver.documentEditor.paragraphStyle": "Paragraph style",
    "template-resolver.documentEditor.placeholder": "Write your text…",
    "template-resolver.documentEditor.removeLink": "Remove link",
    "template-resolver.documentEditor.repeat": "Repeat",
    "template-resolver.documentEditor.repeatList": "List to repeat",
    "template-resolver.documentEditor.resourceKey": "Resource key",
    "template-resolver.documentEditor.table": "Table",
    "template-resolver.editor.titleLabel": "Title",
    "template-resolver.editor.contentLabel": "Content",
    "template-resolver.editor.save": "Save",
    "template-resolver.editor.saving": "Saving…",
    "template-resolver.editor.created": "Created.",
    "template-resolver.editor.saved": "Saved.",
    "templateResolver.errors.document.buttonHrefNotPlaceholder":
      "The button target “{detail}” must be a placeholder.",
    "templateResolver.errors.document.disallowedLinkHref":
      "Link target “{detail}” is not allowed; use https, http, mailto, tel or a placeholder.",
    "templateResolver.errors.document.documentRequiresHtmlFormat":
      "This template kind requires the html format, got “{detail}”.",
    "templateResolver.errors.document.layoutRequiresMjmlFormat":
      "Mail layouts require the mjml format, got “{detail}”.",
    "templateResolver.errors.document.layoutInvalidStructure":
      "The layout may only contain the header, content, signature and footer regions: {detail}.",
    "templateResolver.errors.document.layoutMissingContentSlot":
      "The layout needs its content slot: {detail}.",
    "templateResolver.errors.document.layoutSourceSystemOnly":
      "Only system layouts may use {detail} source; use the structured html layout.",
    "templateResolver.errors.template.targetExists":
      "A template for locale “{detail}” already exists; overwrite it explicitly to replace it.",
    "templateResolver.warnings.resourceNotUploaded": "Image not uploaded: {detail}",
    "templateResolver.checks.resourcesResolved": "All images are available",
    "templateResolver.checks.textPresent": "A plain-text version is present",
    "templateResolver.checks.sizeUnderCap": "The mail is within the 10 MiB size limit",
    "templateResolver.checks.requiredPlaceholders": "All required placeholders are used",
    "templateResolver.errors.preview.renderFailed": "The preview could not be rendered.",
    "templateResolver.errors.testMail.noChannel":
      "No email channel is set up, so no test mail can be sent.",
    "templateResolver.errors.testMail.noAddress":
      "Your account has no email address to send the test mail to.",
    "templateResolver.errors.testMail.failed": "The test mail could not be sent.",
    "templateResolver.errors.resource.tooLarge": "The image is too large.",
    "templateResolver.errors.resource.unsupportedImage":
      "This file is not a supported image. Use PNG, JPEG, WebP or GIF.",
    "templateResolver.errors.template.systemResourcesNeedSystemTenant":
      "Resource files can only be imported as system templates by a user of the system tenant.",
    "templateResolver.errors.collection.kindNotAllowed":
      "“{detail}” templates are written through their own editor, not through a collection.",
    "templateResolver.errors.noSystemTemplate": "There is no active system template to reset to.",
    "templateResolver.errors.template.invalidMeta": "The template settings are invalid.",
    "templateResolver.errors.template.meta.subject.required": "The subject is missing.",
    "templateResolver.errors.template.meta.subject.invalid":
      "The subject is invalid (at most 200 characters, no line breaks).",
    "templateResolver.errors.template.meta.previewText.required": "The preview text is missing.",
    "templateResolver.errors.template.meta.previewText.invalid":
      "The preview text is invalid (at most 200 characters, no line breaks).",
    "templateResolver.errors.template.meta.senderName.required": "The sender name is missing.",
    "templateResolver.errors.template.meta.senderName.invalid":
      "The sender name is invalid (at most 80 characters, no line breaks).",
    "templateResolver.errors.template.meta.replyTo.required": "The reply-to address is missing.",
    "templateResolver.errors.template.meta.replyTo.invalid":
      "The reply-to address is not a valid email address.",
    "templateResolver.errors.template.meta.layoutSlug.required": "The layout is missing.",
    "templateResolver.errors.template.meta.layoutSlug.invalid": "The chosen layout is invalid.",
    "templateResolver.errors.template.meta.fileName.required": "The file name is missing.",
    "templateResolver.errors.template.meta.fileName.invalid":
      "The file name is invalid: no slashes, quotes, semicolons or two dots in a row.",
    "templateResolver.errors.template.unknownPlaceholders": "Unknown placeholders: {detail}",
    "templateResolver.errors.template.missingRequiredPlaceholders":
      "Required placeholders are not used: {detail}",
    "templateResolver.errors.document.embeddedContent":
      "<{detail}> elements are not allowed in template bodies.",
    "templateResolver.errors.document.unsafeAttributeValue":
      "The attribute value “{detail}” must not contain < or >.",
    "templateResolver.errors.document.eventHandlerAttribute":
      "Inline event handler “{detail}” is not allowed.",
    "templateResolver.errors.document.externalImageSource":
      "Images must reference an uploaded resource; image source “{detail}” is not allowed.",
    "templateResolver.errors.document.imageWithoutResource":
      "Images must reference an uploaded resource.",
    "templateResolver.errors.document.invalidReferenceName": "“{detail}” is not a valid name.",
    "templateResolver.errors.document.scriptElement":
      "<script> elements are not allowed in template bodies.",
    "templateResolver.errors.attachment.unsupportedType":
      "Attachments must be a PDF, PNG or JPEG file.",
    "templateResolver.errors.attachment.limit": "A template can have at most {max} attachments.",
    "templateResolver.errors.attachment.invalid":
      "The attachment needs a template, a key and a valid file name.",
    "templateResolver.errors.attachment.pdfTemplateMissing":
      "There is no PDF template “{slug}” for this tenant or the system.",
    "template-resolver.documentEditor.htmlSource": "HTML source",
    "template-resolver.documentEditor.removeBlock": "Remove block",
    "template-resolver.documentEditor.list": "List",
    "template-resolver.documentEditor.more": "More",
    "template-resolver.documentEditor.showHtml": "HTML",
    "template-resolver.documentEditor.underline": "Underline",
    "template-resolver.editor.saveFailed": "Save failed.",
    "template-resolver.editor.networkError": "Network error while saving.",
    "template-resolver.editor.loading": "Loading current version…",
    "template-resolver.editor.loadFailed": "Could not load block",
    "template-resolver.editor.readOnly":
      "Read-only — TenantAdmin or SystemAdmin role required to make changes.",
  },
};
