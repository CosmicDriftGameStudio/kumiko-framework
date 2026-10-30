import { afterEach, describe, expect, mock, test } from "bun:test";
import { fireEvent } from "@testing-library/react";
import { render, screen } from "../../__tests__/test-utils.tsx";
import { ClampedText } from "../clamped-text.tsx";
import { MessageReader } from "../message-reader.tsx";
import { MessageThread } from "../message-thread.tsx";
import type { ThreadMessage } from "../message-types.ts";

const annaFirst: ThreadMessage = {
  id: "m1",
  author: "Anna Schneider",
  address: "a.schneider@mieter.test",
  direction: "incoming",
  timeLabel: "Mo 08:14",
  body: {
    kind: "text",
    text: "Guten Tag,\n\nseit gestern Abend ist meine Heizung komplett kalt.\nBitte melden.",
  },
};
const reply: ThreadMessage = {
  id: "m2",
  author: "Du",
  direction: "outgoing",
  timeLabel: "Mo 09:02",
  body: { kind: "text", text: "Der Monteur kommt am Dienstag zwischen 8 und 10 Uhr." },
};
const annaLast: ThreadMessage = {
  id: "m3",
  author: "Anna Schneider",
  address: "a.schneider@mieter.test",
  direction: "incoming",
  timeLabel: "Heute 09:41",
  body: {
    kind: "text",
    text: [
      "Der Monteur ist nicht gekommen.",
      "",
      "Am 12.03.2026 um 09:02 schrieb Du:",
      "> Der Monteur kommt am Dienstag.",
      "> Zwischen 8 und 10 Uhr.",
    ].join("\n"),
  },
  attachments: [
    {
      id: "a1",
      name: "thermometer-kinderzimmer.jpg",
      meta: "Foto, 1,2 MB",
      kind: "image",
      onOpen: () => {},
    },
  ],
};

describe("MessageThread", () => {
  test("older messages start as one-line rows, the last is open, and a click expands a row", () => {
    render(<MessageThread messages={[annaFirst, reply, annaLast]} />);
    const row = screen.getByTestId("message-row-m1");
    expect(row.textContent).toContain("Anna Schneider");
    expect(row.textContent).toContain(
      "Guten Tag, seit gestern Abend ist meine Heizung komplett kalt. Bitte melden.",
    );
    expect(row.textContent).toContain("Mo 08:14");
    expect(screen.getByTestId("message-open-m3")).toBeTruthy();
    expect(screen.queryByTestId("message-open-m1")).toBeNull();

    fireEvent.click(row);
    expect(screen.getByTestId("message-open-m1")).toBeTruthy();
    expect(screen.queryByTestId("message-row-m1")).toBeNull();
  });

  test("outgoing rows carry the reply icon, incoming rows do not", () => {
    render(<MessageThread messages={[annaFirst, reply, annaLast]} />);
    expect(screen.getByTestId("message-row-m2").querySelector("svg")).not.toBeNull();
    expect(screen.getByTestId("message-row-m1").querySelector("svg")).toBeNull();
  });

  test("quoted text is folded behind a button with the line count and toggles", () => {
    render(<MessageThread messages={[annaLast]} />);
    expect(screen.queryByTestId("message-quoted")).toBeNull();
    fireEvent.click(screen.getByText("Show quoted text (3 lines)"));
    expect(screen.getByTestId("message-quoted").textContent).toContain(
      "Der Monteur kommt am Dienstag.",
    );
    fireEvent.click(screen.getByText("Hide quoted text"));
    expect(screen.queryByTestId("message-quoted")).toBeNull();
  });

  test("shows author, address, time and attachment chips on the open message", () => {
    render(<MessageThread messages={[annaLast]} />);
    const open = screen.getByTestId("message-open-m3");
    expect(open.textContent).toContain("a.schneider@mieter.test");
    expect(open.textContent).toContain("Heute 09:41");
    expect(screen.getByText("thermometer-kinderzimmer.jpg")).toBeTruthy();
    expect(screen.getByText("Foto, 1,2 MB")).toBeTruthy();
  });

  describe("html bodies", () => {
    const htmlMessage: ThreadMessage = {
      ...annaLast,
      body: {
        kind: "html",
        html: '<p>Der Monteur ist <b>nicht</b> gekommen.</p><img src="https://tracker.example/pixel.png"><blockquote type="cite"><p>Der Monteur kommt am Dienstag.</p></blockquote>',
      },
    };

    test("lands in a sandboxed iframe without scripts and with a CSP that blocks https images", () => {
      render(<MessageThread messages={[htmlMessage]} />);
      const frame = screen.getAllByTitle("Anna Schneider")[0] as HTMLIFrameElement;
      expect(frame.tagName).toBe("IFRAME");
      const sandbox = frame.getAttribute("sandbox") ?? "";
      expect(sandbox.split(" ").sort()).toEqual([
        "allow-popups",
        "allow-popups-to-escape-sandbox",
        "allow-same-origin",
      ]);
      expect(sandbox).not.toContain("allow-scripts");
      const srcdoc = frame.getAttribute("srcdoc") ?? "";
      expect(srcdoc).toContain("default-src 'none'; style-src 'unsafe-inline'; img-src data:");
      expect(srcdoc).not.toContain('https:"');
      expect(srcdoc).not.toMatch(/img-src[^"]*https:/);
      expect(srcdoc).toContain('<base target="_blank">');
      expect(srcdoc).toContain("nicht");
      expect(srcdoc).not.toContain("blockquote");
    });

    test("'Bilder anzeigen' reloads the frame with https images allowed", () => {
      render(<MessageThread messages={[htmlMessage]} />);
      expect(screen.getByText("External images are blocked.")).toBeTruthy();
      fireEvent.click(screen.getByText("Show images"));
      const frame = screen.getAllByTitle("Anna Schneider")[0] as HTMLIFrameElement;
      expect(frame.getAttribute("srcdoc")).toContain("img-src data: https: http:");
      expect(screen.queryByText("External images are blocked.")).toBeNull();
    });

    test("remoteImages=allowed skips the bar", () => {
      render(<MessageThread messages={[htmlMessage]} remoteImages="allowed" />);
      expect(screen.queryByTestId("message-images-bar")).toBeNull();
      const frame = screen.getAllByTitle("Anna Schneider")[0] as HTMLIFrameElement;
      expect(frame.getAttribute("srcdoc")).toContain("img-src data: https: http:");
    });

    test("no bar when the html has no external images", () => {
      render(
        <MessageThread
          messages={[{ ...annaLast, body: { kind: "html", html: "<p>Nur Text</p>" } }]}
        />,
      );
      expect(screen.queryByTestId("message-images-bar")).toBeNull();
    });

    test("the html quote sits behind its own toggle", () => {
      render(<MessageThread messages={[htmlMessage]} />);
      expect(screen.getAllByTitle("Anna Schneider").length).toBe(1);
      fireEvent.click(screen.getByText("Show quoted text (1 lines)"));
      expect(screen.getAllByTitle("Anna Schneider").length).toBe(2);
    });
  });
});

describe("ClampedText", () => {
  const original = {
    scrollHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollHeight"),
    clientHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight"),
  };

  function mockBoxHeights(scrollHeight: number, clientHeight: number): void {
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
      configurable: true,
      get: () => scrollHeight,
    });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get: () => clientHeight,
    });
  }

  afterEach(() => {
    for (const [name, descriptor] of Object.entries(original)) {
      if (descriptor === undefined) Reflect.deleteProperty(HTMLElement.prototype, name);
      else Object.defineProperty(HTMLElement.prototype, name, descriptor);
    }
  });

  test("shows the toggle only when the content overflows, and toggles", () => {
    mockBoxHeights(400, 200);
    render(<ClampedText lines={4}>lange Nachricht</ClampedText>);
    fireEvent.click(screen.getByText("Show more"));
    expect(screen.getByText("Show less")).toBeTruthy();
    fireEvent.click(screen.getByText("Show less"));
    expect(screen.getByText("Show more")).toBeTruthy();
  });

  test("short content gets no toggle", () => {
    mockBoxHeights(60, 60);
    render(<ClampedText lines={4}>kurz</ClampedText>);
    expect(screen.queryByText("Show more")).toBeNull();
  });
});

describe("MessageReader", () => {
  const tabs = [
    { id: "att1", label: "Anhang 1: Vertrag.pdf", render: () => <p>PDF-Vorschau Vertrag</p> },
  ];

  test("without attachment tabs there is no tab bar", () => {
    render(<MessageReader thread={{ messages: [annaLast] }} />);
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.getByTestId("message-thread")).toBeTruthy();
  });

  test("with tabs it starts on the mail and switches uncontrolled", () => {
    const onTabChange = mock(() => {});
    render(
      <MessageReader
        thread={{ messages: [annaLast] }}
        attachmentTabs={tabs}
        onTabChange={onTabChange}
      />,
    );
    expect(screen.getByRole("tablist")).toBeTruthy();
    expect(screen.getByTestId("message-thread")).toBeTruthy();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Anhang 1: Vertrag.pdf" }));
    fireEvent.click(screen.getByRole("tab", { name: "Anhang 1: Vertrag.pdf" }));
    expect(screen.getByText("PDF-Vorschau Vertrag")).toBeTruthy();
    expect(screen.queryByTestId("message-thread")).toBeNull();
    expect(onTabChange).toHaveBeenCalledWith("att1");
  });

  test("activeTabId controls the shown tab", () => {
    render(
      <MessageReader thread={{ messages: [annaLast] }} attachmentTabs={tabs} activeTabId="att1" />,
    );
    expect(screen.getByText("PDF-Vorschau Vertrag")).toBeTruthy();
  });
});
