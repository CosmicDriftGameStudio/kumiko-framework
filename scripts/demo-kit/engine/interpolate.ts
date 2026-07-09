/** Replace `{{key}}` placeholders using demo vars (string values only). */

export function interpolate(
  template: string,
  vars: Readonly<Record<string, string | number | boolean>>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const v = vars[key];
    if (v === undefined) {
      throw new Error(`interpolate: missing var "{{${key}}}" in template: ${template.slice(0, 80)}`);
    }
    return String(v);
  });
}
