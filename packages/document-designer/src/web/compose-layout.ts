// @runtime client
export type LayoutRegionValues = {
  readonly header: string;
  readonly signature: string;
  readonly footer: string;
};

// An untouched rich-text editor reports an empty paragraph rather than "".
const EMPTY_REGION = /^(\s|<p>(\s|<br\s*\/?>)*<\/p>)*$/;

// Same top-level div contract the server reads with readLayoutRegions: empty regions are
// left out, the content slot is always present.
export function composeLayoutHtml(regions: LayoutRegionValues): string {
  const region = (name: "header" | "signature" | "footer", regionHtml: string): string =>
    EMPTY_REGION.test(regionHtml) ? "" : `<div data-${name}>${regionHtml}</div>`;
  return [
    region("header", regions.header),
    "<div data-content></div>",
    region("signature", regions.signature),
    region("footer", regions.footer),
  ].join("");
}
