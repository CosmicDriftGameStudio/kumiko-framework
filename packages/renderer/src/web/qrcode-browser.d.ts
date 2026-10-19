// @types/qrcode only declares the main "qrcode" entry, not the browser-only
// subpath. Same runtime shape, just re-typed; `export *` never re-exports a
// default, so the default import relies on allowSyntheticDefaultImports.
declare module "qrcode/lib/browser.js" {
  export * from "qrcode";
}
