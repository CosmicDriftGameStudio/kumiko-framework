import type { ConfigAccessorFactory } from "@cosmicdrift/kumiko-types/config";
import type { AppContext } from "@cosmicdrift/kumiko-types/handlers";

export function configAccessorFactoryOf(
  context: Pick<AppContext, "configAccessorFactory" | "_configAccessorFactory">,
): ConfigAccessorFactory | undefined {
  return context.configAccessorFactory ?? context._configAccessorFactory;
}
