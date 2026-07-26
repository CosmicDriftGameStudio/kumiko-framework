import { describe, expect, mock, test } from "bun:test";
import { createSseBroker, type SseEvent } from "../sse-broker";

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
    const broker = createSseBroker();
    const onInvalidateA = mock();
    const onInvalidateB = mock();

    broker.subscribeAccessInvalidation("user-a", onInvalidateA);
    broker.subscribeAccessInvalidation("user-b", onInvalidateB);

    broker.publishAccessInvalidation("user-a");

    expect(onInvalidateA).toHaveBeenCalledTimes(1);
    expect(onInvalidateB).not.toHaveBeenCalled();
  });

  test("subscribeAccessInvalidation supports multiple listeners on the same user", () => {
    const broker = createSseBroker();
    const first = mock();
    const second = mock();

    broker.subscribeAccessInvalidation("user-a", first);
    broker.subscribeAccessInvalidation("user-a", second);
    broker.publishAccessInvalidation("user-a");

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  test("unsubscribe (returned closure) stops further delivery", () => {
    const broker = createSseBroker();
    const onInvalidate = mock();

    const unsubscribe = broker.subscribeAccessInvalidation("user-a", onInvalidate);
    unsubscribe();
    broker.publishAccessInvalidation("user-a");

    expect(onInvalidate).not.toHaveBeenCalled();
  });

  test("a fired listener can unsubscribe itself without skipping other listeners", () => {
    const broker = createSseBroker();
    let unsubscribeSelf: () => void = () => {};
    const self = mock(() => unsubscribeSelf());
    const other = mock();

    unsubscribeSelf = broker.subscribeAccessInvalidation("user-a", self);
    broker.subscribeAccessInvalidation("user-a", other);
    broker.publishAccessInvalidation("user-a");

    expect(self).toHaveBeenCalledTimes(1);
    expect(other).toHaveBeenCalledTimes(1);
  });

  test("publishAccessInvalidation to a user with no listeners does nothing", () => {
    const broker = createSseBroker();
    expect(() => broker.publishAccessInvalidation("nobody-listening")).not.toThrow();
  });
});
