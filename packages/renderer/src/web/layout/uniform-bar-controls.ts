// Header and toolbar controls share one height whatever size a screen, app or
// primitive asked for: the descendant selector outranks the button's own
// size utilities. Icon-only buttons keep their square size.
export const UNIFORM_BAR_CONTROLS_CLASSES =
  "[&_[data-slot=button]:not([data-size^=icon])]:h-9 [&_[data-slot=input]]:h-9";
