declare const options: { _configAccessorFactory?: () => void };
declare function boot(settings: object): void;

const _configAccessorFactory = options._configAccessorFactory;
const label = "_configAccessorFactory stays in strings";

boot({ _configAccessorFactory, label });
boot({ _configAccessorFactory: options._configAccessorFactory });
const { _configAccessorFactory: renamed } = options;
const { _configAccessorFactory: kept } = options;
void [renamed, kept];
