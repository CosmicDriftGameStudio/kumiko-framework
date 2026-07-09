# Demo-Kit

Nutzdaten in `demos/<id>/`, Engine in `engine/`. Siehe [ARCHITECTURE.md](./ARCHITECTURE.md).

```sh
bun demo-kit list
bun demo-kit validate create-app
bun demo-kit hydrate create-app   # JSON → stdout
```

`scripts/demos/01-create-app.ts` ist ein dünner Loader → `loadDemo("create-app")`.
