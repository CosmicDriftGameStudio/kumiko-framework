const openReason =
  "demo app: any signed-in user manages AI connections and settings; there is no per-user ownership in this sample";
export const open = {
  access: { openToAll: { reason: openReason, personalData: "tenant-members" } },
} as const;
export const openRead = { access: { openToAll: { reason: openReason } } } as const;
