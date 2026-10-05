import { escapeHtml, escapeHtmlAttr } from "@cosmicdrift/kumiko-headless";

export type MailTone = "neutral" | "info" | "success" | "warning" | "danger";
export type MailStageState = "done" | "current" | "upcoming";

export type MailBadge = { readonly label: string; readonly tone?: MailTone };
export type MailStage = { readonly label: string; readonly state: MailStageState };
export type MailChip = { readonly label: string; readonly tone?: MailTone };

type ToneColors = { readonly bg: string; readonly fg: string };

const TONE_COLORS: Readonly<Record<MailTone, ToneColors>> = {
  neutral: { bg: "#f3f4f6", fg: "#374151" },
  info: { bg: "#dbeafe", fg: "#1e40af" },
  success: { bg: "#dcfce7", fg: "#166534" },
  warning: { bg: "#fef3c7", fg: "#92400e" },
  danger: { bg: "#fee2e2", fg: "#991b1b" },
};

const STAGE_STATES: readonly MailStageState[] = ["done", "current", "upcoming"];
const STAGE_DONE_COLOR = "#16a34a";
const STAGE_UPCOMING_BG = "#e5e7eb";
const STAGE_UPCOMING_FG = "#9ca3af";

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}

function isMailTone(value: unknown): value is MailTone {
  return typeof value === "string" && Object.hasOwn(TONE_COLORS, value);
}

function toneColors(tone: unknown): ToneColors {
  return TONE_COLORS[isMailTone(tone) ? tone : "neutral"];
}

function isStageState(value: unknown): value is MailStageState {
  return STAGE_STATES.some((state) => state === value);
}

// Template data is runtime data (variables of a stored template): entries that do not match are
// skipped instead of failing the whole mail.
function isStage(value: unknown): value is MailStage {
  return isRecord(value) && typeof value["label"] === "string" && isStageState(value["state"]);
}

function isChip(value: unknown): value is MailChip {
  return isRecord(value) && typeof value["label"] === "string";
}

export function parseBadge(value: unknown): MailBadge | undefined {
  return isChip(value) && value.label !== "" ? value : undefined;
}

function validStages(value: unknown): readonly MailStage[] {
  return Array.isArray(value) ? value.filter(isStage) : [];
}

function validChips(value: unknown): readonly MailChip[] {
  return Array.isArray(value) ? value.filter(isChip) : [];
}

function pill(chip: MailChip, margin: string): string {
  const { bg, fg } = toneColors(chip.tone);
  return `<span style="display:inline-block;margin:${margin};padding:2px 10px;border-radius:999px;background:${bg};color:${fg};font-size:12px;font-weight:600;line-height:18px">${escapeHtml(chip.label)}</span>`;
}

export function renderBadge(badge: MailBadge): string {
  return `<p style="margin:0 0 12px">${pill(badge, "0")}</p>`;
}

export function renderChips(chips: unknown): string {
  const valid = validChips(chips);
  if (valid.length === 0) return "";
  return `<p style="margin:0 0 16px">${valid.map((chip) => pill(chip, "0 6px 6px 0")).join("")}</p>`;
}

function stageMarker(stage: MailStage, position: number, primaryColor: string): string {
  const base =
    "display:inline-block;width:24px;height:24px;line-height:24px;border-radius:12px;text-align:center;font-size:12px;font-weight:700";
  const primary = escapeHtmlAttr(primaryColor);
  if (stage.state === "done") {
    return `<span style="${base};background:${STAGE_DONE_COLOR};color:#fff">&#10003;</span>`;
  }
  if (stage.state === "current") {
    return `<span style="${base};background:#fff;border:2px solid ${primary};line-height:20px;width:20px;height:20px;color:${primary}">${position}</span>`;
  }
  return `<span style="${base};background:${STAGE_UPCOMING_BG};color:${STAGE_UPCOMING_FG}">${position}</span>`;
}

function stageCell(stage: MailStage, position: number, primaryColor: string): string {
  const labelColor = stage.state === "upcoming" ? STAGE_UPCOMING_FG : "#111";
  const weight = stage.state === "current" ? 700 : 400;
  return `<td align="center" valign="top" style="padding:0 4px;font-family:sans-serif">${stageMarker(stage, position, primaryColor)}<div style="margin:4px 0 0;font-size:12px;font-weight:${weight};color:${labelColor}">${escapeHtml(stage.label)}</div></td>`;
}

function stageConnector(previous: MailStage): string {
  const color = previous.state === "done" ? STAGE_DONE_COLOR : STAGE_UPCOMING_BG;
  return `<td valign="top" style="padding:11px 0 0"><div style="width:24px;height:2px;line-height:2px;font-size:2px;background:${color}">&nbsp;</div></td>`;
}

export function renderStages(stages: unknown, primaryColor: string): string {
  const valid = validStages(stages);
  if (valid.length === 0) return "";
  const cells = valid.map((stage, index) => {
    const previous = valid[index - 1];
    const connector = previous ? stageConnector(previous) : "";
    return `${connector}${stageCell(stage, index + 1, primaryColor)}`;
  });
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px"><tr>${cells.join("")}</tr></table>`;
}

const STAGE_TEXT_MARKER: Readonly<Record<MailStageState, string>> = {
  done: "✓",
  current: "▶",
  upcoming: "○",
};

export function badgeText(badge: MailBadge): string {
  return `[${badge.label}]`;
}

export function stagesText(stages: unknown): string {
  return validStages(stages)
    .map((stage) => `${STAGE_TEXT_MARKER[stage.state]} ${stage.label}`)
    .join(" → ");
}

export function chipsText(chips: unknown): string {
  return validChips(chips)
    .map((chip) => chip.label)
    .join(" · ");
}
