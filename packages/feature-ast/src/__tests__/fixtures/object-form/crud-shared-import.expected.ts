import { type CrudOptions, entityName } from "../engine";

export function setup(registrar: FeatureRegistrar) {
  registrar.crud(entityName, orderEntity, options);
}
