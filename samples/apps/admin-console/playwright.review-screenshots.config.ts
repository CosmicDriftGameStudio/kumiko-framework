import base from "./playwright.config";

export default {
  ...base,
  testMatch: /admin-shell-screenshots\.spec\.ts/,
  use: {
    ...base.use,
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    locale: "de-DE",
  },
};
