import {
  type ExtensionSectionProps,
  usePrimitives,
  useTranslation,
} from "@cosmicdrift/kumiko-renderer";
import { type ReactNode, useMemo, useState } from "react";
import { DocumentContentEditor } from "../../template-resolver/web/index.ts";
import { effectiveBodyFormat } from "./constants.ts";
import { detectLossyMarkdown, type LossyMarkdownFeature } from "./lossy-markdown.ts";
import { markdownToDocumentHtml } from "./markdown-to-document.ts";

const LOSSY_LABEL_KEYS: Readonly<Record<LossyMarkdownFeature, string>> = {
  image: "managed-pages:body.lossy.image",
  blockquote: "managed-pages:body.lossy.blockquote",
  code: "managed-pages:body.lossy.code",
  deepHeading: "managed-pages:body.lossy.deepHeading",
};

const BODY_EDITOR_ID = "managed-pages-page-body";

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

// A Markdown body is converted for display only: nothing is patched until the
// user edits, so merely opening a page never turns it into a document.
export function PageBodySection({ values, patch }: ExtensionSectionProps): ReactNode {
  const t = useTranslation();
  const { Banner } = usePrimitives();
  const body = stringValue(values?.["body"]);
  const isMarkdown = effectiveBodyFormat(values?.["bodyFormat"]) === "markdown";
  const [editedHtml, setEditedHtml] = useState<string | null>(null);
  const [lossyAtFirstEdit, setLossyAtFirstEdit] = useState<readonly LossyMarkdownFeature[] | null>(
    null,
  );

  const pristine = editedHtml === null;
  const convertedHtml = useMemo(
    () => (isMarkdown ? markdownToDocumentHtml(body) : body),
    [isMarkdown, body],
  );
  const liveLossy = useMemo(
    () => (pristine && isMarkdown ? detectLossyMarkdown(body) : []),
    [pristine, isMarkdown, body],
  );
  const lossy = lossyAtFirstEdit ?? liveLossy;

  const handleChange = (next: string): void => {
    if (pristine) setLossyAtFirstEdit(liveLossy);
    setEditedHtml(next);
    patch?.({ body: next, bodyFormat: "document" });
  };

  return (
    <>
      {lossy.length > 0 && (
        <Banner variant="warning">
          {t("managed-pages:body.lossy.warning", {
            features: lossy.map((feature) => t(LOSSY_LABEL_KEYS[feature])).join(", "),
          })}
        </Banner>
      )}
      <DocumentContentEditor
        id={BODY_EDITOR_ID}
        value={editedHtml ?? convertedHtml}
        onChange={handleChange}
        variables={[]}
        readOnly={false}
      />
    </>
  );
}
