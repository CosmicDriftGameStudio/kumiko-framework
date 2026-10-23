declare const options: { _configAccessorFactory?: () => void };
declare function boot(settings: object): void;

const _configAccessorFactory = options.configAccessorFactory;
const label = "_configAccessorFactory stays in strings";

boot({ configAccessorFactory: _configAccessorFactory, label });
boot({ configAccessorFactory: options.configAccessorFactory });
const { configAccessorFactory: renamed } = options;
const { configAccessorFactory: kept } = options;
void [renamed, kept];
