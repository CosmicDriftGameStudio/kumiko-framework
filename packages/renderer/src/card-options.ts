/** Card-Options — Verhalten/Optik, ebenfalls additiv erweiterbar. */
export type CardOptions = {
  /** Body-Padding (px-6 py-6). false = randlos (Tabelle/eigene Tiles). Default true. */
  readonly padded?: boolean;
  /** Eckenradius. Default "xl" (= Entity-Card). */
  readonly radius?: "lg" | "xl";
  /** Separates the footer with `border-t` and `bg-muted/30`. Defaults to true. */
  readonly footerBordered?: boolean;
  /** Footer horizontal padding. false = none, so footer content aligns with the card edge. Default true. */
  readonly footerInset?: boolean;
  /** Joins the ancestor fillHeight flex chain — a tabs-mode
   *  relatedList table sizing to the panel instead of the page — instead of
   *  normal document-flow height. Default false. */
  readonly fillHeight?: boolean;
  /** false drops border, background, shadow and radius but keeps padding and
   *  header slots — a panel inside a host surface such as a tab panel. Default true. */
  readonly framed?: boolean;
  /** The card is the whole screen body (secretMint reveal and done phase):
   *  no frame, the shared screen insets and width of form screens, children
   *  stacked with a gap. Without it such a screen sits raw against the
   *  shell edge. Default false. */
  readonly screenBody?: boolean;
  /** "inline": title and subtitle on one baseline row at 16px inset, compact padding (the board's side panel). Default "stacked". */
  readonly headerLayout?: "stacked" | "inline";
};
