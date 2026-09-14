export const config = {
  verbAccess: {
    create: { openToAll: true },
    list: { roles: ["admin"] },
  },
  read: {
    access: { openToAll: true },
  },
  write: {
    access: { roles: ["admin"] },
  },
};
