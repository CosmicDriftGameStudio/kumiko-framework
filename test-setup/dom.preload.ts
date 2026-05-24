if (typeof globalThis.HTMLElement !== "undefined") {
  const proto = globalThis.HTMLElement.prototype as unknown as Record<string, unknown>;
  if (proto.hasPointerCapture === undefined) proto.hasPointerCapture = () => false;
  if (proto.setPointerCapture === undefined) proto.setPointerCapture = () => undefined;
  if (proto.releasePointerCapture === undefined) proto.releasePointerCapture = () => undefined;
  if (proto.scrollIntoView === undefined) proto.scrollIntoView = () => undefined;
}
