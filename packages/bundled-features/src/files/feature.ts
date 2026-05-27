// files — full Event-Sourcing für File-Metadata. Die Implementierung (Entity,
// files:event:*-Events, Inline-Projektion) lebt seit dem ES-Umbau im
// Framework neben file-routes + fileRefsTable, weil file-routes hart davon
// abhängt (appendDomainEventCore verlangt registrierte Events + Projektion).
// Dieses Modul re-exportiert nur, damit der App-Import-Pfad
// `@cosmicdrift/kumiko-bundled-features/files` stabil bleibt.
export { createFilesFeature, fileRefEntity } from "@cosmicdrift/kumiko-framework/files";
