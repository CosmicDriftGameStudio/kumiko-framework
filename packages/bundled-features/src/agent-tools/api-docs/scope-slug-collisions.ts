import { slugify } from "./anchors.ts";
import type { ApiDocsScope } from "./model.ts";
import type { ApiDocsProblem } from "./problems.ts";

/** Scopes whose domains slugify alike would write the same reference page. */
export function scopeSlugCollisionProblems(
  scopes: readonly Pick<ApiDocsScope, "domain">[],
): readonly ApiDocsProblem[] {
  const domainsBySlug = new Map<string, string[]>();
  for (const { domain } of scopes) {
    const slug = slugify(domain);
    domainsBySlug.set(slug, [...(domainsBySlug.get(slug) ?? []), domain]);
  }
  return [...domainsBySlug].flatMap(([slug, domains]): ApiDocsProblem[] =>
    domains.length > 1 ? [{ kind: "scopeSlugCollision", slug, domains }] : [],
  );
}
