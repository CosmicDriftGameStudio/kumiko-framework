export const config = {
  verbAccess: {
    create: { openToAll: { reason: "test handler callable by any signed-in test user" } },
    list: { roles: ["admin"] },
  },
  read: {
    access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
  },
  write: {
    access: { roles: ["admin"] },
  },
};
