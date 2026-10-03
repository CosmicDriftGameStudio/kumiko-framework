import {
  type ThemePreference,
  useOptionalTranslation,
  useTokenController,
} from "@cosmicdrift/kumiko-renderer";

export type ThemeToggleLabelOptions = {
  /** Title while the next step is the light theme. */
  readonly titleInDark?: string | undefined;
  /** Title while the next step is the dark theme. */
  readonly titleInLight?: string | undefined;
  /** Title while the next step is the automatic theme. */
  readonly titleForAuto?: string | undefined;
};

// light -> dark -> auto -> light: a click describes and applies the NEXT step.
export function nextThemePreference(current: ThemePreference): ThemePreference {
  if (current === "light") return "dark";
  if (current === "dark") return "auto";
  return "light";
}

export function useThemeToggleLabel({
  titleInDark,
  titleInLight,
  titleForAuto,
}: ThemeToggleLabelOptions): {
  readonly nextPreference: ThemePreference;
  readonly title: string;
  readonly cyclePreference: () => void;
} {
  const { mode, preference = mode, setPreference, toggleMode } = useTokenController();
  // Optional: the toggle also renders outside a LocaleProvider (samples, tests).
  const translate = useOptionalTranslation();
  // A TokensApi without setPreference is a plain light/dark implementation: no auto step.
  const nextPreference: ThemePreference = setPreference
    ? nextThemePreference(preference)
    : mode === "dark"
      ? "light"
      : "dark";
  const titles: Record<ThemePreference, string> = {
    light: titleInDark ?? translate?.("kumiko.theme.light") ?? "Light theme",
    dark: titleInLight ?? translate?.("kumiko.theme.dark") ?? "Dark theme",
    auto: titleForAuto ?? translate?.("kumiko.theme.auto") ?? "Automatic theme",
  };
  return {
    nextPreference,
    title: titles[nextPreference],
    cyclePreference: () => {
      if (setPreference) setPreference(nextPreference);
      else toggleMode();
    },
  };
}
