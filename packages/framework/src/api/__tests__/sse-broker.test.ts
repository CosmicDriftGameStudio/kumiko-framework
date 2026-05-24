import { describe, expect, test } from "bun:test";
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
});
