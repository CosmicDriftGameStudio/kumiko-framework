---
"@cosmicdrift/kumiko-renderer-web": patch
---

Form-Kit: `MoneyField`/`PercentField` rendern kein €/%-Einheit-Badge mehr — die Einheit gehört ins Label (`t("…Summe (€)")`), sonst steht sie in Consumer-Apps doppelt. `unit`/`labelAppendix` aus `NumberField` entfernt; die drei Feld-Widgets rendern jetzt identisch, `MoneyField`/`PercentField` bleiben als semantische Call-Site-Aliase (Andockpunkt für spätere geld-/prozent-spezifische Formatierung).
