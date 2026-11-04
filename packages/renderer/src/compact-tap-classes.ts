// The button looks 32px high but keeps a 44px touch area: the ::before layer reaches 6px past the
// visible border on top and bottom. Tailwind needs the literal class string.
export const COMPACT_TAP_CLASSES =
  "relative h-8 px-2.5 text-xs max-md:min-h-0 before:absolute before:inset-x-0 before:-inset-y-1.5 before:content-['']";
