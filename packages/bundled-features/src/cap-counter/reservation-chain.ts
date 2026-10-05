import type {
  PreTransactionReservation,
  ReservationHandle,
} from "@cosmicdrift/kumiko-types/handlers";

type ReservationOutcome = Awaited<ReturnType<PreTransactionReservation>>;

function toHandle(outcome: ReservationOutcome): ReservationHandle {
  if (outcome === undefined)
    return { release: async () => {}, confirmInTransaction: async () => {} };
  if (typeof outcome === "function") {
    return { release: outcome, confirmInTransaction: async () => {} };
  }
  return outcome;
}

// Runs `inner` first, then `own`; a failing `own` gives the inner reservation back before it
// throws. Release goes in reverse order, confirm covers both.
export function chainReservations(
  inner: PreTransactionReservation | undefined,
  own: PreTransactionReservation,
): PreTransactionReservation {
  if (!inner) return own;
  return async (event, ctx) => {
    const innerHandle = toHandle(await inner(event, ctx));
    let ownHandle: ReservationHandle;
    try {
      ownHandle = toHandle(await own(event, ctx));
    } catch (error) {
      try {
        await innerHandle.release();
      } catch (releaseError) {
        ctx.log?.error("releasing the inner cap reservation failed", { error: releaseError });
      }
      throw error;
    }
    return {
      release: async () => {
        try {
          await ownHandle.release();
        } finally {
          await innerHandle.release();
        }
      },
      confirmInTransaction: async (confirm) => {
        await innerHandle.confirmInTransaction(confirm);
        await ownHandle.confirmInTransaction(confirm);
      },
    };
  };
}
