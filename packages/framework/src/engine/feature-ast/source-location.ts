// SourceLocation — wo im Feature-File ein erkannter `r.*`-Call (oder ein
// opaker Code-Bereich darin) lebt. Wird vom AST-Visitor an jedes
// FeaturePattern angehängt damit:
//
//   - Designer auf den File-Bereich zeigen kann ("scroll to source")
//   - AI-Patcher gezielt diesen Bereich überschreiben kann (kein
//     Re-Generate des ganzen Files)
//   - Opaque Bodies (z.B. writeHandler-Closure, hook-fn) als Code-Block
//     im Designer angezeigt werden können (raw enthält den vollen Quelltext)
//
// Lines + columns sind 1-basiert um TS-LSP-Konvention zu folgen — der
// Designer kann sie 1:1 an Monaco/CodeMirror durchreichen.

export type SourcePosition = {
  readonly line: number;
  readonly column: number;
};

export type SourceLocation = {
  readonly file: string;
  readonly start: SourcePosition;
  readonly end: SourcePosition;
  // Raw source text vom start..end-Range. Für Round-Trip-Display
  // (Custom-Body als read-only Block im Designer rendern) +
  // Diff-Generation beim Patchen (Original-vs-Neu vergleichen).
  readonly raw: string;
};
