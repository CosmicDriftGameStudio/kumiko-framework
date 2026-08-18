German UI and mail copy for Kumiko. Core ships English only; mount this package when the app should show German framework screens.

```ts
import { localeDe } from "@cosmicdrift/kumiko-locale-de";
import { localeDeClient } from "@cosmicdrift/kumiko-locale-de/web";

// server feature list
localeDe();

// createKumikoApp({ clientFeatures: [localeDeClient(), ...] })
```
