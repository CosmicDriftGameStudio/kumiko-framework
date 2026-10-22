// No imports: web/ re-exports these, and template-meta.ts pulls in zod and the framework engine.
export const MAIL_LAYOUT_WIDTHS = [560, 600, 640] as const;
export const MAIL_LAYOUT_FONTS = ["sans", "serif"] as const;
export const MAIL_LAYOUT_ACCENT_LINES = ["branding", "none"] as const;
export const MAIL_LAYOUT_BUTTON_STYLES = ["filled-rounded", "filled-square", "outline"] as const;

// Colors end up inside MJML attributes, so only a strict hex is ever written there.
export const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
