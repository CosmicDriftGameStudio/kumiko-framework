const QN_TYPE_SEGMENTS = new Set(["query", "write"]);
const HEADING_SEPARATOR = ": ";

/** `helpdesk:write:ticket:close` becomes ["ticket", "close"]: the feature prefix and
 *  the `query`/`write` kind are noise inside a page that already names both. */
function tailSegments(qn: string): readonly string[] {
  const segments = qn.split(":");
  const rest = segments.slice(1);
  return rest[0] !== undefined && QN_TYPE_SEGMENTS.has(rest[0]) ? rest.slice(1) : rest;
}

export function handlerHeading(qn: string): string {
  return tailSegments(qn).join(HEADING_SEPARATOR);
}

function fullHeading(qn: string): string {
  return qn.split(":").join(HEADING_SEPARATOR);
}

/** GitHub-style slug: lower case, punctuation dropped, spaces to hyphens. */
export function slugify(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

export type HandlerAnchor = {
  readonly qn: string;
  readonly heading: string;
  readonly anchor: string;
};

/** Events are headed by their exact QN. Declared (`feature:name`) and entity (`entity.verb`) QNs can
 *  slug alike once punctuation is dropped, so repeats get GitHub's `-1`, `-2` suffix in QN order. */
export function eventAnchors(qns: readonly string[]): readonly HandlerAnchor[] {
  const used = new Set<string>();
  return qns.map((qn) => {
    const base = slugify(qn);
    let anchor = base;
    for (let repeat = 1; used.has(anchor); repeat++) anchor = `${base}-${repeat}`;
    used.add(anchor);
    return { qn, heading: qn, anchor };
  });
}

/** Short headings, except when two handlers of one page would get the same slug:
 *  both then switch to the full QN form, which is unique by construction. */
export function anchorsForPage(qns: readonly string[]): readonly HandlerAnchor[] {
  const shortSlugCount = new Map<string, number>();
  for (const qn of qns) {
    const slug = slugify(handlerHeading(qn));
    shortSlugCount.set(slug, (shortSlugCount.get(slug) ?? 0) + 1);
  }
  return qns.map((qn) => {
    const isCollision = (shortSlugCount.get(slugify(handlerHeading(qn))) ?? 0) > 1;
    const heading = isCollision ? fullHeading(qn) : handlerHeading(qn);
    return { qn, heading, anchor: slugify(heading) };
  });
}
