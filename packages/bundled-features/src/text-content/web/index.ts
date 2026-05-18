// @runtime client
// Public exports für die Browser-Seite des text-content Features.
// Wird über den Sub-Path-Export `@cosmicdrift/kumiko-bundled-features/text-content/web`
// konsumiert — die Server-Seite (defineFeature) lebt in
// `@cosmicdrift/kumiko-bundled-features/text-content` und hat keine
// React-/DOM-Deps. Trennung bleibt sauber so wie renderer vs renderer-web.

export { textContentClient } from "./client-plugin";
