French UI and mail copy for Kumiko. Core ships English only; mount this package when the app should show French framework screens.

```ts
import { localeFr } from "@cosmicdrift/kumiko-locale-fr";
import { localeFrClient } from "@cosmicdrift/kumiko-locale-fr/web";

// server feature list
localeFr();

// createKumikoApp({ clientFeatures: [localeFrClient(), ...] })
```
