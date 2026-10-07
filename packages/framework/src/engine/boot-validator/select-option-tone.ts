import { SELECT_OPTION_TONES, type SelectOptionTone } from "@cosmicdrift/kumiko-types/fields";

export function isSelectOptionTone(value: unknown): value is SelectOptionTone {
  return SELECT_OPTION_TONES.some((tone) => tone === value);
}
