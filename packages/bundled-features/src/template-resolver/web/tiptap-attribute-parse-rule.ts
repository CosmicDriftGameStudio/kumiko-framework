type AttributeSource = { getAttribute(name: string): string | null };

export function attributeParseRule(rule: {
  readonly tag: string;
  readonly attribute: string;
  readonly key: string;
  readonly isValid: (value: string) => boolean;
  readonly priority?: number;
}) {
  const { tag, attribute, key, isValid, priority } = rule;
  return {
    tag,
    ...(priority === undefined ? {} : { priority }),
    getAttrs: (element: AttributeSource): Record<string, string> | false => {
      const value = element.getAttribute(attribute);
      return value !== null && isValid(value) ? { [key]: value } : false;
    },
  };
}
