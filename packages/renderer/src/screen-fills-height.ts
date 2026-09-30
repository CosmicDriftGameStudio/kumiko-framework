export function screenFillsHeight(screen: { readonly fillHeight?: boolean }): boolean {
  return screen.fillHeight !== false;
}
