Spanish UI and mail copy for Kumiko. Core ships English only; mount this package when the app should show Spanish framework screens.

```ts
import { localeEs } from "@cosmicdrift/kumiko-locale-es";
import { localeEsClient } from "@cosmicdrift/kumiko-locale-es/web";

// server feature list
localeEs();

// createKumikoApp({ clientFeatures: [localeEsClient(), ...] })
```
