import { defaultPrimitives } from "../primitives/index.tsx";
import { screen } from "./test-utils.tsx";

export const {
  Button,
  Banner,
  Field,
  Input,
  DataTable,
  Form,
  Text,
  Heading,
  Dialog,
  Card,
  Section,
} = defaultPrimitives;

// Padding utilities of one element, sorted — every screen container must
// resolve to the same set (fw#2640).
export const paddingClasses = (el: Element | null | undefined): string[] =>
  (el?.className ?? "")
    .split(" ")
    .filter((c) => /^p[xytblr]?-/.test(c))
    .sort();

export const paddingOf = (testId: string): string[] => paddingClasses(screen.getByTestId(testId));
