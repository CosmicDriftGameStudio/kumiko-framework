import { describe, expect, mock, test } from "bun:test";
import {
  createSseBroker,
  type SseBroker,
  type SseEvent,
  shouldInvalidateListener,
} from "../sse-broker";

function requireAccessInvalidation(broker: SseBroker) {
  const subscribe = broker.subscribeAccessInvalidation;
  const publish = broker.publishAccessInvalidation;
  if (!subscribe || !publish) {
    throw new Error("createSseBroker must implement access-invalidation hooks");
  }
  return { subscribe, publish };
}

describe("SSE broker", () => {
  test("adds client and tracks count", () => {
    const broker = createSseBroker();
    broker.addClient("ch1", mock(), mock());
    broker.addClient("ch1", mock(), mock());
    broker.addClient("ch2", mock(), mock());

    expect(broker.getClientCount("ch1")).toBe(2);
    expect(broker.getClientCount("ch2")).toBe(1);
    expect(broker.getTotalClientCount()).toBe(3);
  });

  test("pushToChannel sends to all clients on channel", () => {
    const broker = createSseBroker();
    const send1 = mock();
    const send2 = mock();
    const sendOther = mock();

    broker.addClient("users", send1, mock());
    broker.addClient("users", send2, mock());
    broker.addClient("other", sendOther, mock());

    const event: SseEvent = { type: "user.created", data: { id: 1 } };
    broker.pushToChannel("users", event);

    expect(send1).toHaveBeenCalledWith(event);
    expect(send2).toHaveBeenCalledWith(event);
    expect(sendOther).not.toHaveBeenCalled();
  });

  test("removeClient stops delivery", () => {
    const broker = createSseBroker();
    const send = mock();

    const clientId = broker.addClient("ch", send, mock());
    broker.removeClient("ch", clientId);

    broker.pushToChannel("ch", { type: "test", data: {} });
    expect(send).not.toHaveBeenCalled();
    expect(broker.getClientCount("ch")).toBe(0);
  });

  test("pushToChannel to empty channel does nothing", () => {
    const broker = createSseBroker();
    // Should not throw
    broker.pushToChannel("empty", { type: "test", data: {} });
    expect(broker.getClientCount("empty")).toBe(0);
  });

  test("removeClient from unknown channel does nothing", () => {
    const broker = createSseBroker();
    expect(() => broker.removeClient("unknown", "fake-id")).not.toThrow();
    expect(broker.getClientCount("unknown")).toBe(0);
  });

  test("subscribeAccessInvalidation fires only listeners on the same user's channel", () => {
    const { subscribe, publish } = requireAccessInvalidation(createSseBroker());
    const onInvalidateA = mock();
    const onInvalidateB = mock();

    subscribe("user-a", onInvalidateA);
    subscribe("user-b", onInvalidateB);

    publish("user-a");

    expect(onInvalidateA).toHaveBeenCalledTimes(1);
    expect(onInvalidateB).not.toHaveBeenCalled();
  });

  test("subscribeAccessInvalidation supports multiple listeners on the same user", () => {
    const { subscribe, publish } = requireAccessInvalidation(createSseBroker());
    const first = mock();
    const second = mock();

    subscribe("user-a", first);
    subscribe("user-a", second);
    publish("user-a");

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  test("unsubscribe (returned closure) stops further delivery", () => {
    const { subscribe, publish } = requireAccessInvalidation(createSseBroker());
    const onInvalidate = mock();

    const unsubscribe = subscribe("user-a", onInvalidate);
    unsubscribe();
    publish("user-a");

    expect(onInvalidate).not.toHaveBeenCalled();
  });

  test("a fired listener can unsubscribe itself without skipping other listeners", () => {
    const { subscribe, publish } = requireAccessInvalidation(createSseBroker());
    let unsubscribeSelf: () => void = () => {};
    const self = mock(() => unsubscribeSelf());
    const other = mock();

    unsubscribeSelf = subscribe("user-a", self);
    subscribe("user-a", other);
    publish("user-a");

    expect(self).toHaveBeenCalledTimes(1);
    expect(other).toHaveBeenCalledTimes(1);
  });

  test("publishAccessInvalidation to a user with no listeners does nothing", () => {
    const { publish } = requireAccessInvalidation(createSseBroker());
    expect(() => publish("nobody-listening")).not.toThrow();
  });

  test("publishAccessInvalidation with an all-except-session scope spares only the listener whose own sid matches exactly", () => {
    const { subscribe, publish } = requireAccessInvalidation(createSseBroker());
    const spared = mock();
    const unrelated = mock();

    subscribe("user-a", spared, { sid: "sid-kept" });
    subscribe("user-a", unrelated, { sid: "sid-other" });
    publish("user-a", { kind: "all-except-session", keptSessionId: "sid-kept" });

    expect(spared).not.toHaveBeenCalled();
    expect(unrelated).toHaveBeenCalledTimes(1);
  });

  test("all-except-session still closes a listener whose sid was already revoked through an eventless path (keep-list, not a kill-list)", () => {
    const { subscribe, publish } = requireAccessInvalidation(createSseBroker());
    const alreadyRevoked = mock();

    // Simulates a stream from a session logged out earlier via a path that
    // never appended session-revoked — the keep-list must not accidentally
    // exempt it just because its sid isn't the freshly-kept one.
    subscribe("user-a", alreadyRevoked, { sid: "sid-logged-out-earlier" });
    publish("user-a", { kind: "all-except-session", keptSessionId: "sid-kept" });

    expect(alreadyRevoked).toHaveBeenCalledTimes(1);
  });

  test("all-except-session still fires a listener with no sid of its own (fail-closed, e.g. a PAT/bearer stream)", () => {
    const { subscribe, publish } = requireAccessInvalidation(createSseBroker());
    const sidless = mock();

    subscribe("user-a", sidless);
    publish("user-a", { kind: "all-except-session", keptSessionId: "sid-kept" });

    expect(sidless).toHaveBeenCalledTimes(1);
  });

  test("no scope (unscoped) still invalidates every listener, matching pre-scoping behavior", () => {
    const { subscribe, publish } = requireAccessInvalidation(createSseBroker());
    const first = mock();
    const second = mock();

    subscribe("user-a", first, { sid: "sid-1" });
    subscribe("user-a", second, { sid: "sid-2" });
    publish("user-a");

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  test("sessions scope closes only the matching sid, spares an unrelated sid and a PAT listener", () => {
    const { subscribe, publish } = requireAccessInvalidation(createSseBroker());
    const matching = mock();
    const otherSid = mock();
    const patListener = mock();

    subscribe("user-a", matching, { sid: "sid-1" });
    subscribe("user-a", otherSid, { sid: "sid-2" });
    subscribe("user-a", patListener, { patTokenId: "tok-1" });
    publish("user-a", { kind: "sessions", sessionIds: ["sid-1"] });

    expect(matching).toHaveBeenCalledTimes(1);
    expect(otherSid).not.toHaveBeenCalled();
    expect(patListener).not.toHaveBeenCalled();
  });

  test("sessions scope closes a credential-less listener (fail-closed)", () => {
    const { subscribe, publish } = requireAccessInvalidation(createSseBroker());
    const credentialless = mock();

    subscribe("user-a", credentialless);
    publish("user-a", { kind: "sessions", sessionIds: ["sid-1"] });

    expect(credentialless).toHaveBeenCalledTimes(1);
  });

  test("pat-tokens scope closes only the matching tokenId, spares an unrelated PAT and a session listener", () => {
    const { subscribe, publish } = requireAccessInvalidation(createSseBroker());
    const matching = mock();
    const otherToken = mock();
    const sessionListener = mock();

    subscribe("user-a", matching, { patTokenId: "tok-1" });
    subscribe("user-a", otherToken, { patTokenId: "tok-2" });
    subscribe("user-a", sessionListener, { sid: "sid-1" });
    publish("user-a", { kind: "pat-tokens", tokenIds: ["tok-1"] });

    expect(matching).toHaveBeenCalledTimes(1);
    expect(otherToken).not.toHaveBeenCalled();
    expect(sessionListener).not.toHaveBeenCalled();
  });

  test("pat-tokens scope closes a credential-less listener (fail-closed)", () => {
    const { subscribe, publish } = requireAccessInvalidation(createSseBroker());
    const credentialless = mock();

    subscribe("user-a", credentialless);
    publish("user-a", { kind: "pat-tokens", tokenIds: ["tok-1"] });

    expect(credentialless).toHaveBeenCalledTimes(1);
  });
});

describe("shouldInvalidateListener matrix", () => {
  const sidListener = { sid: "sid-1" };
  const patListener = { patTokenId: "tok-1" };
  const bareListener = {};

  test("user scope always closes", () => {
    const scope = { kind: "user" as const };
    expect(shouldInvalidateListener(sidListener, scope)).toBe(true);
    expect(shouldInvalidateListener(patListener, scope)).toBe(true);
    expect(shouldInvalidateListener(bareListener, scope)).toBe(true);
  });

  test("all-except-session spares only the exact kept sid, closes everything else including credential-less", () => {
    const scope = { kind: "all-except-session" as const, keptSessionId: "sid-1" };
    expect(shouldInvalidateListener(sidListener, scope)).toBe(false);
    expect(shouldInvalidateListener({ sid: "sid-2" }, scope)).toBe(true);
    expect(shouldInvalidateListener(patListener, scope)).toBe(true);
    expect(shouldInvalidateListener(bareListener, scope)).toBe(true);
  });

  test("sessions scope closes a matching sid and a credential-less listener, spares everything else", () => {
    const scope = { kind: "sessions" as const, sessionIds: ["sid-1"] };
    expect(shouldInvalidateListener(sidListener, scope)).toBe(true);
    expect(shouldInvalidateListener({ sid: "sid-2" }, scope)).toBe(false);
    expect(shouldInvalidateListener(patListener, scope)).toBe(false);
    expect(shouldInvalidateListener(bareListener, scope)).toBe(true);
  });

  test("pat-tokens scope closes a matching tokenId and a credential-less listener, spares everything else", () => {
    const scope = { kind: "pat-tokens" as const, tokenIds: ["tok-1"] };
    expect(shouldInvalidateListener(patListener, scope)).toBe(true);
    expect(shouldInvalidateListener({ patTokenId: "tok-2" }, scope)).toBe(false);
    expect(shouldInvalidateListener(sidListener, scope)).toBe(false);
    expect(shouldInvalidateListener(bareListener, scope)).toBe(true);
  });
});
