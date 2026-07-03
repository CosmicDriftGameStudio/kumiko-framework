---
"@cosmicdrift/kumiko-renderer-web": minor
---

Card chrome (padding, radius, shadow) is now driven by `--card-padding` / `--card-radius` / `--card-shadow` CSS tokens. Framework ships defaults that reproduce the current look exactly (`p-6` / `rounded-xl` / `shadow-sm`); an app overrides any subset in its own `styles.css` to re-theme every card at once — no component changes. Unset tokens fall back to the framework default.
