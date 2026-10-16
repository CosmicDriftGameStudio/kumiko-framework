// @runtime client
import { cn } from "@cosmicdrift/kumiko-renderer-web";
import { createElement, type ReactNode, useMemo } from "react";

// Layout regions arrive server-sanitised, but the preview still renders them
// through a whitelist instead of innerHTML so a sanitiser gap can never run
// markup in the admin session. Unknown elements are unwrapped, scripts dropped.

const TAG_CLASSES: Readonly<Record<string, string>> = {
  div: "",
  p: "m-0",
  span: "",
  strong: "font-semibold",
  b: "font-semibold",
  em: "italic",
  i: "italic",
  u: "underline",
  small: "text-xs",
  h1: "m-0 text-lg font-semibold",
  h2: "m-0 text-base font-semibold",
  h3: "m-0 text-sm font-semibold",
  table: "w-full border-collapse",
  thead: "",
  tbody: "",
  tr: "",
  td: "align-top",
  th: "align-top text-left font-semibold",
  ul: "m-0 list-disc pl-5",
  ol: "m-0 list-decimal pl-5",
  li: "",
  a: "underline",
  hr: "my-1 border-border",
  br: "",
  img: "max-h-12 max-w-full object-contain",
};

const VOID_TAGS: ReadonlySet<string> = new Set(["br", "hr", "img"]);
const DROPPED_TAGS: ReadonlySet<string> = new Set(["script", "style", "iframe", "object", "embed"]);
const SAFE_IMAGE_SRC = /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/;

const ALIGN_CLASSES: Readonly<Record<string, string>> = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
  justify: "text-justify",
};

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

export type LayoutHtmlProps = {
  readonly html: string;
  /** Label per system placeholder (`data-variable`), shown as a chip. */
  readonly systemLabels: Readonly<Record<string, string>>;
  /** Display URL of an `img[data-resource]` key (the tenant logo, a linked image); no URL drops the image. */
  readonly resourceSrc?: (key: string) => string | undefined;
};

function renderChildren(node: Node, props: LayoutHtmlProps, path: string): ReactNode[] {
  return Array.from(node.childNodes).map((child, index) =>
    renderNode(child, props, `${path}.${index}`),
  );
}

function renderNode(node: Node, props: LayoutHtmlProps, path: string): ReactNode {
  if (node.nodeType === TEXT_NODE) return node.textContent;
  if (node.nodeType !== ELEMENT_NODE) return null;
  const tag = node.nodeName.toLowerCase();
  if (DROPPED_TAGS.has(tag)) return null;
  if (!(node instanceof Element)) return null;
  if (!(tag in TAG_CLASSES)) return <span key={path}>{renderChildren(node, props, path)}</span>;

  const variable = node.getAttribute("data-variable");
  if (variable !== null) {
    return (
      <span
        key={path}
        className="mx-0.5 inline-flex rounded border border-primary/30 bg-primary/10 px-1.5 text-xs text-primary"
      >
        {props.systemLabels[variable] ?? variable}
      </span>
    );
  }

  const align = ALIGN_CLASSES[node.getAttribute("data-align") ?? ""];
  const className = cn(
    TAG_CLASSES[tag],
    align,
    node.getAttribute("data-size") === "small" && "text-xs",
  );
  if (tag === "img") {
    const resource = node.getAttribute("data-resource");
    if (resource !== null) {
      const resourceUrl = props.resourceSrc?.(resource);
      if (resourceUrl === undefined) return null;
      return createElement("img", {
        key: path,
        className: "max-h-10 max-w-40 object-contain",
        src: resourceUrl,
        alt: node.getAttribute("alt") ?? resource,
      });
    }
    const src = node.getAttribute("src") ?? "";
    if (!SAFE_IMAGE_SRC.test(src)) return null;
    return createElement("img", { key: path, className, src, alt: node.getAttribute("alt") ?? "" });
  }
  if (VOID_TAGS.has(tag)) return createElement(tag, { key: path, className });
  return createElement(tag, { key: path, className }, ...renderChildren(node, props, path));
}

export function LayoutHtml(props: LayoutHtmlProps): ReactNode {
  const { html } = props;
  const body = useMemo(() => new DOMParser().parseFromString(html, "text/html").body, [html]);
  return <>{renderChildren(body, props, "r")}</>;
}
