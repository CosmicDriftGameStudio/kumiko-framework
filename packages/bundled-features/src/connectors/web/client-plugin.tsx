import { translationsByLocaleFromKeys } from "@cosmicdrift/kumiko-renderer";
import type { ClientFeatureDefinition } from "@cosmicdrift/kumiko-renderer/web";
import { ConnectorScreens, FILE_NAME_CELL_COMPONENT } from "./client-constants.ts";
import { FileNameCell } from "./file-name-cell.tsx";
import { CONNECTOR_FILES_I18N } from "./files-i18n.ts";
import { ConnectorFilesScreen } from "./files-screen.tsx";

// Apps mount it in createKumikoApp({ clientFeatures: [connectorsClient()] }) for the file tree screen.
export function connectorsClient(): ClientFeatureDefinition {
  return {
    name: "connectors",
    translations: translationsByLocaleFromKeys(CONNECTOR_FILES_I18N),
    components: { [ConnectorScreens.files]: ConnectorFilesScreen },
    columnRenderers: { [FILE_NAME_CELL_COMPONENT]: FileNameCell },
  };
}
