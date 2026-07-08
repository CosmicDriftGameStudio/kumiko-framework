---
"@cosmicdrift/kumiko-renderer-web": minor
---

Toast-`variant` nutzt jetzt `StatusTone` (`ok`/`warn`/`bad`/`critical`/`muted`, dieselbe Farbfamilie wie `StatusBadge`) statt `default`/`destructive`. Breaking: `variant: "destructive"` → `variant: "bad"`, Default ist jetzt `muted`.
