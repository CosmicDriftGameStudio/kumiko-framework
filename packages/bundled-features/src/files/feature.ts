// files — complete event sourcing for file metadata. The implementation (entity,
// files:event:*-events, inline projection) lives in the framework alongside
// file-routes and fileRefsTable because file-routes depends on registered events
// and a projection, as required by appendDomainEventCore.
// This module only re-exports the feature to keep the app import path
// `@cosmicdrift/kumiko-bundled-features/files` stable.
export { createFilesFeature, fileRefEntity } from "@cosmicdrift/kumiko-framework/files";
