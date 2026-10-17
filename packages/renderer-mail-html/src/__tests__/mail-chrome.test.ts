import { describe, expect, test } from "bun:test";
import { brandHeaderHtml, headerRowHtml, readMailTone, toneColors } from "../mail-chrome";

describe("mail chrome", () => {
  test("only a known tone name selects colors", () => {
    expect(readMailTone(" Warning ")).toBe("warning");
    expect(readMailTone("red")).toBeUndefined();
    expect(readMailTone(undefined)).toBeUndefined();
  });

  test("the accent tone follows the branding color and falls back to the default", () => {
    expect(toneColors("accent", "#2b3fe0")).toEqual({
      bar: "#2b3fe0",
      fg: "#2b3fe0",
      soft: "#eaecfc",
    });
    expect(toneColors("accent", "nope").bar).toBe("#1f5468");
    expect(toneColors("warning", "#2b3fe0").bar).toBe("#F2B53A");
  });

  test("without a logo the brand row shows an initial tile in the accent color", () => {
    const html = brandHeaderHtml({
      tenantName: "acme <Cloud>",
      suffix: "Status",
      logoSrc: undefined,
      accentColor: "#2b3fe0",
    });
    expect(html).toContain("background:#2b3fe0");
    expect(html).toContain(">A</span>");
    expect(html).toContain("acme &lt;Cloud&gt;");
    expect(html).toContain(">Status</span>");
    expect(html).not.toContain("<img");
  });

  test("with a logo the brand row shows the logo at 28px height", () => {
    const html = brandHeaderHtml({
      tenantName: "Acme",
      suffix: "",
      logoSrc: "cid:logo",
      accentColor: "#2b3fe0",
    });
    expect(html).toContain('<img src="cid:logo" alt="" height="28"');
    expect(html).not.toContain("Status");
  });

  test("the chip sits beside the brand and escapes its label", () => {
    const html = headerRowHtml("BRAND", "Neuer <Incident>", toneColors("warning", undefined));
    expect(html).toContain('<td align="left" style="vertical-align:middle">BRAND</td>');
    expect(html).toContain("Neuer &lt;Incident&gt;");
    expect(html).toContain("background:#FEF4E2");
    expect(headerRowHtml("BRAND", " ", toneColors("warning", undefined))).toBe("BRAND");
  });
});
