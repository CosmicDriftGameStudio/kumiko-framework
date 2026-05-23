---
"@cosmicdrift/kumiko-dev-server": patch
---

`Dockerfile.template` emits an inline `start.sh` for createBunServer command-override target.

`infra/pulumi/bun-server.ts`'s `createBunServer` overrides the container command with `exec ./start.sh` after injecting DATABASE_URL from the init-container. Apps deployed via createBunServer crashed with `./start.sh: not found` until each one added a per-app `start.sh` in repo root (= studio's PR #22).

Now the Dockerfile-template emits the file inline (`RUN printf … > ./start.sh && chmod +x`). Apps no longer need to ship one — the runtime stage generates it. Apps that don't go through createBunServer's command-override still boot via the bottom CMD; start.sh is dead-code in that case.
