import { useOptionalTranslation, useTokenController } from "@cosmicdrift/kumiko-renderer";

export type ThemeToggleLabelOptions = {
  readonly titleInDark?: string | undefined;
  readonly titleInLight?: string | undefined;
};

export function useThemeToggleLabel({ titleInDark, titleInLight }: ThemeToggleLabelOptions): {
  readonly isDark: boolean;
  readonly title: string;
  readonly toggleMode: () => void;
} {
  const { mode, toggleMode } = useTokenController();
  // Optional: the toggle also renders outside a LocaleProvider (samples, tests).
  const translate = useOptionalTranslation();
  const isDark = mode === "dark";
  const title = isDark
    ? (titleInDark ?? translate?.("kumiko.theme.light") ?? "Light theme")
    : (titleInLight ?? translate?.("kumiko.theme.dark") ?? "Dark theme");
  return { isDark, title, toggleMode };
}
