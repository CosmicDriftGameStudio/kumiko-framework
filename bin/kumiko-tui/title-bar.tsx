import { Box, Text } from "ink";
import { useMemo, type ReactNode } from "react";
import { theme } from "./theme";
import type { Role } from "./types";

const LOGO_TOP = "✨  ⭐   ✨    ⭐    ✨   ⭐   ✨";
const LOGO_BOTTOM = "🍺   ✨   🍺    ⭐    🍺   ✨   🍺";

const LOGO_ROWS = [
  "██╗  ██╗██╗   ██╗███╗   ███╗██╗██╗  ██╗ ██████╗ ",
  "██║ ██╔╝██║   ██║████╗ ████║██║██║ ██╔╝██╔═══██╗",
  "█████╔╝ ██║   ██║██╔████╔██║██║█████╔╝ ██║   ██║",
  "██╔═██╗ ██║   ██║██║╚██╔╝██║██║██╔═██╗ ██║   ██║",
  "██║  ██╗╚██████╔╝██║ ╚═╝ ██║██║██║  ██╗╚██████╔╝",
  "╚═╝  ╚═╝ ╚═════╝ ╚═╝     ╚═╝╚═╝╚═╝  ╚═╝ ╚═════╝ ",
] as const;

type Slogan = { readonly claim: string; readonly fineprint: string };

const SLOGANS: ReadonlyArray<Slogan> = [
  { claim: "The fastest framework in the known universe.", fineprint: "universe limited to n=1." },
  { claim: "100% of developers agree Kumiko is the greatest framework ever built.", fineprint: "we asked the author." },
  { claim: "The most enterprise-ready framework of all time.", fineprint: "day one hasn't arrived yet." },
  { claim: "The most battle-tested framework in human history.", fineprint: "history of demo samples." },
  { claim: "The multi-tenantest multi-tenant framework ever conceived.", fineprint: "tenant count: 1." },
  { claim: "The most zero-config framework on planet Earth.", fineprint: "after the mandatory 47-step setup." },
  { claim: "The realtime-est realtime framework in existence.", fineprint: "<1ms latency, on localhost, Wi-Fi off." },
  { claim: "Scales to the most users imaginable.", fineprint: "imagination limited by your wallet." },
  { claim: "The type-safest framework ever written by human hands.", fineprint: "`any` is still also a type." },
  { claim: "Works on more machines than any framework before it.", fineprint: "machines in sample: 1." },
  { claim: "Quite possibly the single greatest framework of the 21st century.", fineprint: "century still in progress." },
];

export function TitleBar({ role }: { readonly role: Role }): ReactNode {
  // Slogan einmal pro Session — useMemo([]) hält ihn stable über re-renders.
  const slogan = useMemo(
    () => SLOGANS[Math.floor(Math.random() * SLOGANS.length)] ?? SLOGANS[0]!,
    [],
  );
  const roleBadge =
    role === "maintainer"
      ? { label: "maintainer", color: theme.warn }
      : { label: "app-dev", color: theme.accent };

  return (
    <Box borderStyle="round" borderColor={theme.accent} paddingX={1} flexDirection="row">
      <Box flexDirection="column" flexGrow={1}>
        <Text>    {LOGO_TOP}</Text>
        {LOGO_ROWS.map((row, i) => (
          <Text key={i} color={theme.accent}>
            {row}
          </Text>
        ))}
        <Text>     {LOGO_BOTTOM}</Text>
        <Box marginTop={1}>
          <Text>{slogan.claim}</Text>
          {slogan.fineprint ? <Text dimColor>*</Text> : null}
        </Box>
        {slogan.fineprint ? (
          <Text dimColor>* {slogan.fineprint}</Text>
        ) : null}
      </Box>

      <Box flexDirection="column" alignItems="flex-end">
        <Text dimColor>role</Text>
        <Text color={roleBadge.color} bold>
          {roleBadge.label}
        </Text>
      </Box>
    </Box>
  );
}
