import type { ExtensionSectionProps } from "@cosmicdrift/kumiko-renderer";
import { DetailList } from "@cosmicdrift/kumiko-renderer-web";
import type { ReactNode } from "react";

// Registered under the `__component` name the feature's review section
// points at (see feature.ts) — never imported by feature.ts itself, the
// string name is the only link so the server file stays free of the
// renderer-web graph.
export function ListingReviewSection({ values }: ExtensionSectionProps): ReactNode {
  return (
    <DetailList
      testId="listing-review"
      rows={[
        { label: "Title", value: String(values?.["title"] ?? "") },
        { label: "Category", value: String(values?.["category"] ?? "") },
        { label: "Price", value: String(values?.["price"] ?? "") },
        { label: "Condition", value: String(values?.["condition"] ?? "") },
      ]}
    />
  );
}
