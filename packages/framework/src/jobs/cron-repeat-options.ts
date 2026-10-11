export type CronTrigger = { readonly cron: string; readonly tz?: string | undefined };

export type CronRepeatOptions = { readonly pattern: string; readonly tz?: string };

export function cronRepeatOptions(trigger: CronTrigger): CronRepeatOptions {
  return trigger.tz === undefined
    ? { pattern: trigger.cron }
    : { pattern: trigger.cron, tz: trigger.tz };
}
