import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { APEX_LIGHTBOX_HTML, APEX_LIGHTBOX_SCRIPT } from "../index.ts";

const URL_A = "https://example.test/a.png";
const URL_B = "https://example.test/b.png";
const URL_C = "https://example.test/c.png";

const SCRIPT_BODY = APEX_LIGHTBOX_SCRIPT.replace(/^<script>/, "").replace(/<\/script>$/, "");

type DocumentListener = [type: string, listener: EventListenerOrEventListenerObject];

let documentListeners: DocumentListener[];
let originalAddEventListener: typeof document.addEventListener;

function mount(shotSources: readonly string[]): HTMLImageElement[] {
  document.body.innerHTML = `${APEX_LIGHTBOX_HTML}${shotSources
    .map((src) => `<div class="shot-frame"><img src="${src}" alt="shot"></div>`)
    .join("")}<img id="outside" src="https://example.test/outside.png" alt="outside">`;
  const dialog = document.getElementById("apex-lightbox") as HTMLDialogElement;
  // happy-dom may not implement showModal; the script only needs `open` to flip.
  dialog.showModal = () => dialog.setAttribute("open", "");
  new Function(SCRIPT_BODY)();
  return Array.from(document.querySelectorAll<HTMLImageElement>(".shot-frame img"));
}

function lightboxImage(): HTMLImageElement {
  return document.querySelector(".apex-lightbox__img") as HTMLImageElement;
}

function button(name: "prev" | "next"): HTMLButtonElement {
  return document.querySelector(`.apex-lightbox__${name}`) as HTMLButtonElement;
}

beforeEach(() => {
  documentListeners = [];
  originalAddEventListener = document.addEventListener.bind(document);
  // The script binds to `document`; track the listeners so each test starts clean.
  document.addEventListener = ((type: string, listener: EventListenerOrEventListenerObject) => {
    documentListeners.push([type, listener]);
    originalAddEventListener(type, listener);
  }) as typeof document.addEventListener;
});

afterEach(() => {
  for (const [type, listener] of documentListeners) document.removeEventListener(type, listener);
  document.addEventListener = originalAddEventListener;
  document.body.innerHTML = "";
});

describe("Apex lightbox navigation", () => {
  const urls = [URL_A, URL_B, URL_C];

  test("clicking a screenshot opens it and prev/next wrap around the list", () => {
    const shots = mount(urls);
    shots[0]?.click();
    expect(lightboxImage().src).toBe(URL_A);

    button("prev").click();
    expect(lightboxImage().src).toBe(URL_C);

    button("next").click();
    expect(lightboxImage().src).toBe(URL_A);
  });

  test("arrow keys step through the list while the dialog is open", () => {
    const shots = mount(urls);
    shots[1]?.click();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    expect(lightboxImage().src).toBe(URL_C);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft" }));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft" }));
    expect(lightboxImage().src).toBe(URL_A);
  });

  test("a single screenshot hides both navigation buttons", () => {
    const shots = mount([URL_A]);
    shots[0]?.click();

    expect(button("prev").hidden).toBe(true);
    expect(button("next").hidden).toBe(true);
  });

  test("an image outside the screenshot list is not a lightbox target", () => {
    mount(urls);
    document.getElementById("outside")?.click();

    expect(lightboxImage().getAttribute("src")).toBeNull();
    expect(document.getElementById("apex-lightbox")?.hasAttribute("open")).toBe(false);
  });
});
