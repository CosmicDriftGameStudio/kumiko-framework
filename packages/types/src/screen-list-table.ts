export const LIST_TABLE_DENSITIES = ["comfortable", "compact"] as const;
export type ListTableDensity = (typeof LIST_TABLE_DENSITIES)[number];

export const LIST_TABLE_OPTION_KEYS = [
  "rememberState",
  "resetAll",
  "columnPicker",
  "density",
] as const;
export const LIST_TABLE_DENSITY_KEYS = ["default", "userChoice"] as const;

/** Opt-in table behaviour of a list. Without the block a list renders and behaves exactly as before. */
export type ListTableOptions = {
  /** Keeps search, sort, page size, facets and date range for the browser session and restores them when the screen is opened without list parameters in the URL. A link with parameters always wins. */
  readonly rememberState?: boolean;
  /** Replaces the facet reset with one button that resets search, sort, page size, facets and date range, and drops the remembered list parameters (column and density choices stay). */
  readonly resetAll?: boolean;
  /** Lets the user hide and reorder columns in the view menu. Columns marked `hidden` start hidden. */
  readonly columnPicker?: boolean;
  readonly density?: {
    /** Row density on first visit. Default "comfortable". */
    readonly default?: ListTableDensity;
    /** Shows the density choice in the view menu and remembers it per session. */
    readonly userChoice?: boolean;
  };
};
