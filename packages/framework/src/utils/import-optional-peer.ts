import { errorCodeOf } from "@cosmicdrift/kumiko-types/type-guards";

export type OptionalPeer = {
  readonly name: string;
  readonly range: string;
  readonly requiredBy: string;
};

// Bun and Node both report a missing package as ERR_MODULE_NOT_FOUND with
// "Cannot find package '<name>' imported from ...". A peer's own missing
// dependency carries a different name, so it must not be mistaken for the peer.
function isPeerItselfMissing(error: unknown, peerName: string): boolean {
  return (
    errorCodeOf(error) === "ERR_MODULE_NOT_FOUND" &&
    error instanceof Error &&
    error.message.includes(`'${peerName}'`)
  );
}

export async function importOptionalPeer<T>(
  peer: OptionalPeer,
  importer: () => Promise<T>,
): Promise<T> {
  try {
    return await importer();
  } catch (error) {
    if (!isPeerItselfMissing(error, peer.name)) throw error;
    throw new Error(
      `${peer.name} is not installed. ${peer.requiredBy} needs it as a peer dependency: bun add ${peer.name}@${peer.range}`,
      { cause: error },
    );
  }
}
