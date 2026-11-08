// Shared look of toggle chips in forms (multiSelect chips, value chips, AI-assist chips): 26px
// pill with a 1px border; a chosen chip gets a primary border and a light primary fill. Passed as
// Button `className`; the phone keeps the same height instead of the 44px touch minimum.
const CHOICE_CHIP_BASE =
  "h-[26px] rounded-full border px-3 text-[13px] font-medium max-md:min-h-[26px]";

export function choiceChipClass(selected: boolean): string {
  return selected
    ? `${CHOICE_CHIP_BASE} border-primary bg-primary/10 text-primary ring-0`
    : `${CHOICE_CHIP_BASE} border-border bg-background text-foreground`;
}
