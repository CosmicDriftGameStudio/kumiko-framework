import * as z from "zod";

/** authserv-id of the mailbox's own server, set only through set-trusted-authserv-id; null or empty clears it. */
export const trustedAuthservIdInputSchema = z.string().trim().max(255).nullable();
