import type { ConfigAccessorFactory } from "@cosmicdrift/kumiko-types/config";
import type { AppContext } from "@cosmicdrift/kumiko-types/handlers";

export function configAccessorFactoryOf(
  context: Pick<AppContext, "configAccessorFactory">,
): ConfigAccessorFactory | undefined {
  return context.configAccessorFactory;
}
