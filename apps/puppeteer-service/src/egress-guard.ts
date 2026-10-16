// Egress guard (enterprise#267): the service loads nothing from the network.
// The client embeds every resource as a data: URI, so any other request is
// refused. Without network fetches there is no DNS rebinding and no reachable
// node IPs, kubelet or NodePorts; a NetworkPolicy cannot block loopback, this can.

const ALLOWED_PROTOCOLS = new Set(["data:", "about:", "blob:"]);

export function isBlockedRequestUrl(rawUrl: string): boolean {
  try {
    return !ALLOWED_PROTOCOLS.has(new URL(rawUrl).protocol);
  } catch {
    return true;
  }
}
