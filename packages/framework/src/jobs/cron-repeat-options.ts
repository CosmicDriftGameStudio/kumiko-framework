import type { JobTrigger } from "@cosmicdrift/kumiko-types/config";
import { DEFAULT_MAINTENANCE_WINDOW, type MaintenanceWindow } from "./maintenance-window.ts";

export type CronTrigger = { readonly cron: string; readonly tz?: string | undefined };

export type CronRepeatOptions = { readonly pattern: string; readonly tz?: string };

export type ScheduledTrigger =
  | Extract<JobTrigger, { readonly cron: string }>
  | Extract<JobTrigger, { readonly maintenance: true }>;

export function isScheduledTrigger(trigger: JobTrigger): trigger is ScheduledTrigger {
  return "cron" in trigger || "maintenance" in trigger;
}

export function cronRepeatOptions(trigger: CronTrigger): CronRepeatOptions {
  return trigger.tz === undefined
    ? { pattern: trigger.cron }
    : { pattern: trigger.cron, tz: trigger.tz };
}

export function scheduleRepeatOptions(
  trigger: ScheduledTrigger,
  window: MaintenanceWindow = DEFAULT_MAINTENANCE_WINDOW,
): CronRepeatOptions {
  return "cron" in trigger
    ? cronRepeatOptions(trigger)
    : { pattern: `${window.minute} ${window.hour} * * *`, tz: "UTC" };
}
