import type { ReactNode } from "react";
import { usePrimitives } from "../primitives.js";

export type ResolvedSuccessLink = {
  readonly key: string;
  readonly label: string;
  readonly href: string;
  readonly onPress: () => void;
};

export type ActionFormSuccessState = {
  readonly text: string;
  readonly links: readonly ResolvedSuccessLink[];
};

export function ActionFormSuccessBanner({
  success,
}: {
  readonly success: ActionFormSuccessState;
}): ReactNode {
  const { Banner, Link } = usePrimitives();
  return (
    <Banner variant="info" testId="action-form-success">
      {success.text}
      {success.links.map((link) => (
        <Link
          key={link.key}
          href={link.href}
          onPress={link.onPress}
          className="ml-2 underline"
          testId={`action-form-success-link-${link.key}`}
        >
          {link.label}
        </Link>
      ))}
    </Banner>
  );
}
