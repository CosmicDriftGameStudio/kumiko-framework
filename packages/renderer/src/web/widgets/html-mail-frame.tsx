import { type ReactNode, useMemo } from "react";

type MailFrameStyle = { readonly fontFamily: string; readonly color: string };

function stripMarkup(value: string): string {
  return value.replace(/[<>]/g, "");
}

export function buildMailSrcDoc(
  html: string,
  options: { readonly allowRemoteImages: boolean; readonly style: MailFrameStyle },
): string {
  const imageSources = options.allowRemoteImages ? "img-src data: https: http:" : "img-src data:";
  const csp = `default-src 'none'; style-src 'unsafe-inline'; ${imageSources}`;
  const { fontFamily, color } = options.style;
  const baseStyle = `html,body{margin:0;background:transparent}body{font-family:${stripMarkup(fontFamily)};font-size:15px;line-height:1.55;color:${stripMarkup(color)};overflow-wrap:anywhere}img{max-width:100%;height:auto}a{color:inherit}`;
  return [
    '<!doctype html><html><head><meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${csp}">`,
    '<base target="_blank"><style>',
    baseStyle,
    "</style></head><body>",
    html,
    "</body></html>",
  ].join("");
}

function pageStyle(): MailFrameStyle {
  if (typeof document === "undefined" || typeof getComputedStyle === "undefined") {
    return { fontFamily: "sans-serif", color: "inherit" };
  }
  const computed = getComputedStyle(document.body);
  return { fontFamily: computed.fontFamily || "sans-serif", color: computed.color || "inherit" };
}

/** Renders server-sanitized mail HTML in a script-free, origin-less sandboxed iframe. */
export function HtmlMailFrame({
  html,
  title,
  allowRemoteImages,
  testId,
}: {
  readonly html: string;
  readonly title: string;
  readonly allowRemoteImages: boolean;
  readonly testId?: string;
}): ReactNode {
  const srcDoc = useMemo(
    () => buildMailSrcDoc(html, { allowRemoteImages, style: pageStyle() }),
    [html, allowRemoteImages],
  );
  return (
    <iframe
      title={title}
      data-testid={testId}
      // No allow-scripts and no allow-same-origin: the frame runs nothing and has an opaque origin.
      // That also means the parent cannot measure the content, so the frame has a fixed height and scrolls itself.
      sandbox="allow-popups allow-popups-to-escape-sandbox"
      srcDoc={srcDoc}
      className="block h-[32rem] w-full border-0"
    />
  );
}
