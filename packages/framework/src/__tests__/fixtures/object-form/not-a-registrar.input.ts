import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";

export const feature = defineFeature("sessions", (r) => {
  const sessions = createSessionStore();
  sessions.requires("x");
  foo.entity("a", b);
  router.hook("get", "/x", handler);
  ctx.queryHandler("a", schema, handler, options);
  r.requires.projection("t");
});

function other(r: Router) {
  r.hook("get", "/x", handler);
}

function shadowed() {
  defineFeature("y", (r) => {
    const inner = (r: Router) => r.entity("a", b);
    return inner;
  });
}
