/** True when a reference field's `entity` ("user" or "<feature>:user") targets the user entity. */
export function isUserEntityReference(referenceTarget: string): boolean {
  const entityName = referenceTarget.includes(":")
    ? referenceTarget.split(":")[1]
    : referenceTarget;
  return entityName === "user";
}
