// The dist build type-checks renderer-web's source through the workspace link,
// and renderer-web's own ambient declaration for this browser-only subpath is
// outside this program; @types/qrcode only declares the main "qrcode" entry.
declare module "qrcode/lib/browser.js" {
  export * from "qrcode";
}
