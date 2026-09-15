# @cosmicdrift/kumiko-guards

AST-based security guards for a single Kumiko repo: direct filesystem
access, direct fetch, direct entity writes, admin-API misuse, tenant
escalation, undeclared escape hatches, `openToAll` without a reason, and
missing access-denied tests. Every finding must clear the repo's own
security baseline — there is no per-guard skip flag.

```
bun node_modules/@cosmicdrift/kumiko-guards/src/run-guards.ts [--explain|--write-security-baseline]
```

The baseline lives at `.kumiko-security-baseline.json` in the consumer
repo's root. `--explain` prints the resolved repo and per-guard scan scope
without running any guard; `--write-security-baseline` freezes current
findings into the baseline file.
