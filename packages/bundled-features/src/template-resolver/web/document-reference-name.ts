const REFERENCE_NAME = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/;
const FORBIDDEN_REFERENCE_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);

// Segments that hit the prototype chain are refused: the renderer later walks
// the dotted path into a data object. Kept apart from document-schema so client code
// can validate a name without loading tiptap.
export function isDocumentReferenceName(value: string): boolean {
  return (
    REFERENCE_NAME.test(value) &&
    !value.split(".").some((segment) => FORBIDDEN_REFERENCE_SEGMENTS.has(segment))
  );
}
