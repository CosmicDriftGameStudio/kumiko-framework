import { access, defineWriteHandler, pipeline } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";

// Logout — JWT is stateless, so server-side we only return OK. A future
// revocation list / session table can land here without changing the
// route or client API. Keeping the handler makes the API shape stable.
export const logoutWrite = defineWriteHandler({
  name: "logout",
  schema: z.object({}),
  access: { roles: access.authenticated },
  perform: pipeline(({ r }) => [r.step.return({ isSuccess: true, data: { kind: "logged-out" } })]),
});
