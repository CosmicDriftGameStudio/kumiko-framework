// @types/qrcode only declares the main "qrcode" entry, not the browser-only
// subpath (see mfa-enable-screen.tsx's import — the main entry pulls in
// Node-only deps like yargs/pngjs via qrcode's own package.json#browser
// remap, which Metro doesn't honor). Same runtime shape, just re-typed.
// `export *` never re-exports a default — `import QRCode from "..."`
// resolving here relies on the consuming app's esModuleInterop/
// allowSyntheticDefaultImports (which synthesizes a default from the
// namespace). Copy this file into apps that need it, but note that
// requirement — without it, the default import comes back undefined.
declare module "qrcode/lib/browser" {
  export * from "qrcode";
}
