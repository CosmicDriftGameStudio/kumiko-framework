export const RENTAL_QUERIES = {
  leaseAkte: "rental:query:lease:akte",
  leaseAkteDraft: "rental:query:lease:akte-draft",
  partyList: "rental:query:lease-party:list",
  positionList: "rental:query:lease:positions",
  kennzahlen: "rental:query:lease:kennzahlen",
} as const;

export const RENTAL_WRITES = {
  leaseTerminate: "rental:write:lease:terminate",
  leaseActivate: "rental:write:lease:activate",
  rentAdjust: "rental:write:rent:adjust",
  positionsRecord: "rental:write:lease:record-positions",
} as const;
