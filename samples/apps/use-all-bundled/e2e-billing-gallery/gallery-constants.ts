// @runtime test
//
// Framework-free constants shared by the gallery server and spec (the spec
// runs in a Playwright worker and must not pull the server import chain).

export const GALLERY_PROVIDER = "gallery-mock-provider";
export const GALLERY_TERMS_SLUG = "gallery-terms";
export const GALLERY_OPERATOR_EMAIL = "billing@gallery.example";
export const GALLERY_PLAN_PATH = "/tenant-admin/billing-plans";

// "localhost" resolves the SYSTEM tenant like the stock dev app; the numeric
// loopback host resolves none and plays the platform apex.
export const GALLERY_TENANT_HOST = "localhost";
export const GALLERY_APEX_HOST = "127.0.0.1";

export const GALLERY_PRICE_IDS = { starter: "price_gallery_starter", pro: "price_gallery_pro" };
