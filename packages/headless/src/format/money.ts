// Currency decimal places — covers the world's zero- and three-decimal
// outliers, defaults to 2 for everything else. Shared between renderer-web's
// MoneyInput (minor-unit display factor) and RenderField's minor/major-unit
// conversion (kumiko-framework#1923) — a single source keeps both sides
// scaling the same currency the same way.
export function currencyDecimals(code: string): number {
  if (code === "JPY" || code === "KRW" || code === "VND" || code === "ISK") return 0;
  if (code === "BHD" || code === "JOD" || code === "KWD" || code === "OMR" || code === "TND")
    return 3;
  return 2;
}
