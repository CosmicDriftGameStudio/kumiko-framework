// @types/qrcode only declares the main "qrcode" entry, not the browser-only
// subpath (see mfa-enable-screen.tsx's import — the main entry pulls in
// Node-only deps like yargs/pngjs via qrcode's own package.json#browser
// remap, which Metro doesn't honor). Same runtime shape, just re-typed.
declare module "qrcode/lib/browser" {
  export * from "qrcode";
}
