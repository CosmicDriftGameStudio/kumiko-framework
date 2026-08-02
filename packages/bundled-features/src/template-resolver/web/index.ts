// @runtime client
// Public exports for the browser side of template-resolver. Consumed through
// the sub-path export `@cosmicdrift/kumiko-bundled-features/template-resolver/web`
// — the server side (defineFeature) lives in
// `@cosmicdrift/kumiko-bundled-features/template-resolver` and has no React or
// DOM deps.

export { textBlocksClient } from "./client-plugin";
