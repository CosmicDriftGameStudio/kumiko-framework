import type { Registry } from "@cosmicdrift/kumiko-framework/engine";

export function notificationTypeNames(registry: Registry, type: string): readonly string[] {
  const renamedFrom = registry.getAllNotifications().get(type)?.renamedFrom ?? [];
  return [type, ...renamedFrom];
}

export function currentNotificationType(registry: Registry, type: string): string {
  for (const [name, definition] of registry.getAllNotifications()) {
    if (definition.renamedFrom?.includes(type)) return name;
  }
  return type;
}
