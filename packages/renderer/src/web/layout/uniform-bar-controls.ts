// Header and toolbar controls share one height whatever size a screen, app or
// primitive asked for: the descendant selector outranks the button's own
// size utilities. Icon-only buttons keep their square size.
export const UNIFORM_BAR_CONTROLS_CLASSES =
  "[&_[data-slot=button]:not([data-size^=icon])]:h-9 [&_[data-slot=input]]:h-9";

// The shell header's own controls (workspace and tenant switcher, language, theme) are h-8,
// so screen actions portalled next to them get h-8 too instead of the toolbar's h-9.
export const SHELL_HEADER_CONTROLS_CLASSES =
  "[&_[data-slot=button]:not([data-size^=icon])]:h-8 [&_[data-slot=input]]:h-8";
