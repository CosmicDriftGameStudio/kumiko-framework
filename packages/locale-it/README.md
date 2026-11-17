Italian UI and mail copy for Kumiko. Core ships English only; mount this package when the app should show Italian framework screens.

```ts
import { localeIt } from "@cosmicdrift/kumiko-locale-it";
import { localeItClient } from "@cosmicdrift/kumiko-locale-it/web";

// server feature list
localeIt();

// createKumikoApp({ clientFeatures: [localeItClient(), ...] })
```
