import { type CrudOptions, registerEntityCrud as registerCrud, entityName } from "../engine";

export function setup(registrar: FeatureRegistrar) {
  registerCrud(registrar, entityName, orderEntity, options);
}
