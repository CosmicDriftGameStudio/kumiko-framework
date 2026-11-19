import {
  createConnectorRoutes,
  createConnectorsFeature,
} from "@cosmicdrift/kumiko-bundled-features/connectors";

// The feature holds the pairing and intake logic; the routes are what the satellite talks to.
// Mount both: `features: [..., connectorsFeature]` and `extraRoutes: connectorRoutes`.
export const connectorsFeature = createConnectorsFeature();
export const connectorRoutes = createConnectorRoutes({ maxUploadBytes: 20 * 1024 * 1024 });
