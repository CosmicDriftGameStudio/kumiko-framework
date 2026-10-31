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

  test("showHeaders false drops author, address and time but keeps body and attachments", () => {
    render(<MessageThread messages={[annaLast]} showHeaders={false} />);
    expect(screen.queryByTestId("message-header-m3")).toBeNull();
    const open = screen.getByTestId("message-open-m3");
    expect(open.textContent).not.toContain("a.schneider@mieter.test");
    expect(open.textContent).toContain("Der Monteur ist nicht gekommen.");
    expect(screen.getByText("thermometer-kinderzimmer.jpg")).toBeTruthy();
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

    test("'Load images' reloads the frame with https images allowed", () => {
      render(<MessageThread messages={[htmlMessage]} />);
      const notice = screen.getByTestId("message-images-bar");
      expect(notice.textContent).toContain("HTML mail, shown sanitized. External images blocked.");
      const action = screen.getByText("Load images");
      expect(action.tagName).toBe("BUTTON");
      expect(action.className).toContain("text-primary");
      expect(action.className).toContain("underline");
      fireEvent.click(action);
      const frame = screen.getAllByTitle("Anna Schneider")[0] as HTMLIFrameElement;
      expect(frame.getAttribute("srcdoc")).toContain("img-src data: https: http:");
      expect(screen.queryByTestId("message-images-bar")).toBeNull();
    });

    test("blocked images are hidden instead of a broken frame; allowed images are not", () => {
      const { unmount } = render(<MessageThread messages={[htmlMessage]} />);
      const blocked = (screen.getAllByTitle("Anna Schneider")[0] as HTMLIFrameElement).getAttribute(
        "srcdoc",
      );
      expect(blocked).toContain('img:not([src^="data:"]){display:none}');
      unmount();
      render(<MessageThread messages={[htmlMessage]} remoteImages="allowed" />);
      const allowed = (screen.getAllByTitle("Anna Schneider")[0] as HTMLIFrameElement).getAttribute(
        "srcdoc",
      );
      expect(allowed).not.toContain("display:none");
    });

    test("sanitized tables have no outer border and thin row dividers", () => {
      render(
        <MessageThread
          messages={[
            {
              ...annaLast,
              body: {
                kind: "html",
                html: '<table border="1"><tr><td>Heizung</td><td>468,00</td></tr></table>',
              },
            },
          ]}
        />,
      );
      const srcdoc =
        (screen.getAllByTitle("Anna Schneider")[0] as HTMLIFrameElement).getAttribute("srcdoc") ??
        "";
      expect(srcdoc).toContain("table{border-collapse:collapse;border:0}");
      expect(srcdoc).toContain("td,th{border:0;border-top:1px solid color-mix");
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

    // Bodies as the inbound sanitizer leaves them: only the quote markers survive, no other class or type.
    test.each([
      [
        "Gmail",
        '<div>Danke!</div><div class="gmail_quote"><div>Am Mo schrieb Du:</div><blockquote class="gmail_quote"><p>Der Monteur kommt.</p></blockquote></div>',
      ],
      [
        "Apple Mail",
        '<div>Danke!</div><blockquote type="cite"><div>Am 12.03. schrieb Du:</div><div>Der Monteur kommt.</div></blockquote>',
      ],
      [
        "Outlook",
        '<div>Danke!</div><div id="appendonsend"></div><div id="divRplyFwdMsg">Von: Du</div><p>Der Monteur kommt.</p>',
      ],
    ])("folds the quote of a sanitized %s body", (_client, html) => {
      render(<MessageThread messages={[{ ...annaLast, body: { kind: "html", html } }]} />);
      expect(screen.getAllByTitle("Anna Schneider").length).toBe(1);
      expect(screen.getByText(/^Show quoted text \(\d+ lines\)$/)).toBeTruthy();
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

  test("a folded thread offers the whole mail instead of more, a plain thread keeps show more", () => {
    mockBoxHeights(400, 200);
    const { rerender } = render(
      <MessageThread messages={[reply, annaLast]} clampLines={4} foldOlderTogether />,
    );
    expect(screen.getByText("Read the whole mail")).toBeTruthy();
    rerender(<MessageThread messages={[reply, annaLast]} clampLines={4} />);
    expect(screen.getByText("Show more")).toBeTruthy();
  });

  test("a folded thread cuts an html mail short by height, a plain thread shows it whole", () => {
    mockBoxHeights(400, 90);
    const htmlLast: ThreadMessage = {
      ...annaLast,
      body: { kind: "html", html: "<p>Der Monteur ist <b>nicht</b> gekommen.</p>" },
    };
    const { rerender } = render(
      <MessageThread messages={[reply, htmlLast]} clampLines={4} foldOlderTogether />,
    );
    fireEvent.click(screen.getByText("Read the whole mail"));
    expect(screen.getByText("Show less")).toBeTruthy();
    rerender(<MessageThread messages={[reply, htmlLast]} clampLines={4} />);
    expect(screen.queryByText("Read the whole mail")).toBeNull();
    expect(screen.queryByText("Show more")).toBeNull();
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

describe("MessageThread layout details", () => {
  test("collapsed rows carry sender, one-line snippet and short date; outgoing rows say Du with the reply icon", () => {
    render(<MessageThread messages={[annaFirst, reply, annaLast]} />);
    const incoming = screen.getByTestId("message-row-m1");
    expect(incoming.textContent).toContain("Anna Schneider");
    expect(incoming.textContent).toContain("Guten Tag, seit gestern Abend");
    expect(incoming.textContent).not.toContain("\n");
    expect(incoming.textContent).toContain("Mo 08:14");
    const own = screen.getByTestId("message-row-m2");
    expect(own.textContent).toContain("Du");
    expect(own.querySelector('[data-testid="message-outgoing-icon"]')).not.toBeNull();
  });

  test("the open message header keeps name, email and date on one non-wrapping line", () => {
    render(<MessageThread messages={[annaLast]} />);
    const header = screen.getByTestId("message-header-m3");
    expect(header.className).not.toContain("flex-wrap");
    expect(header.children[0]?.className).toContain("whitespace-nowrap");
    expect(header.textContent).toBe("Anna Schneidera.schneider@mieter.testHeute 09:41");
  });

  test("reader attachment tabs show icon and detail text, counts stay plain", () => {
    render(
      <MessageReader
        thread={{ messages: [annaLast] }}
        attachmentTabs={[
          {
            id: "att1",
            label: "Mietvertrag.pdf",
            detail: "4 Seiten",
            icon: <svg data-testid="pdf-icon" />,
            render: () => <p>PDF</p>,
          },
        ]}
      />,
    );
    const tab = screen.getByRole("tab", { name: /Mietvertrag\.pdf/ });
    expect(tab.textContent).toContain("4 Seiten");
    expect(tab.querySelector('[data-testid="pdf-icon"]')).not.toBeNull();
    expect(screen.getByRole("tablist").className).toContain("h-10");
  });
});

describe("MessageThread folded older messages", () => {
  test("foldOlderTogether shows one toggle for the older messages, a click lists them as rows", () => {
    render(<MessageThread messages={[annaFirst, reply, annaLast]} foldOlderTogether />);
    expect(screen.queryByTestId("message-row-m1")).toBeNull();
    expect(screen.queryByTestId("message-row-m2")).toBeNull();
    expect(screen.getByTestId("message-open-m3")).toBeTruthy();
    fireEvent.click(screen.getByText("2 earlier mails"));
    expect(screen.getByTestId("message-row-m1")).toBeTruthy();
    expect(screen.getByTestId("message-row-m2")).toBeTruthy();
    expect(screen.queryByTestId("message-thread-earlier")).toBeNull();
  });

  test("one older message gets the singular toggle, a single message none", () => {
    const { rerender } = render(<MessageThread messages={[reply, annaLast]} foldOlderTogether />);
    expect(screen.getByText("1 earlier mail")).toBeTruthy();
    rerender(<MessageThread messages={[annaLast]} foldOlderTogether />);
    expect(screen.queryByTestId("message-thread-earlier")).toBeNull();
  });
});

describe("MessageThread attachments on a folded thread", () => {
  const withThumbnail: ThreadMessage = {
    ...annaLast,
    attachments: [
      {
        id: "a1",
        name: "vertrag.pdf",
        meta: "PDF, 4 Seiten",
        kind: "pdf",
        href: "/files/vertrag.pdf",
        thumbnailUrl: "/thumbs/vertrag.png",
      },
    ],
  };

  test("foldOlderTogether renders the last mail's attachments as cards after the frame, not as chips", () => {
    render(<MessageThread messages={[reply, withThumbnail]} foldOlderTogether />);
    const attachments = screen.getByTestId("message-thread-attachments");
    expect(attachments.textContent).toContain("vertrag.pdf");
    expect(attachments.textContent).toContain("View original");
    expect(screen.getByTestId("message-thread").contains(attachments)).toBe(false);
    expect(screen.getByTestId("message-open-m3").textContent).not.toContain("vertrag.pdf");
  });

  test("without foldOlderTogether the attachments stay chips inside the sheet", () => {
    render(<MessageThread messages={[reply, withThumbnail]} />);
    expect(screen.queryByTestId("message-thread-attachments")).toBeNull();
    expect(screen.getByTestId("message-open-m3").textContent).toContain("vertrag.pdf");
    expect(screen.queryByText("View original")).toBeNull();
  });
});
