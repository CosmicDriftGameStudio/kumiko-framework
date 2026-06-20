# Pin-drift check for publish-with-oidc.sh packed manifests.
# Input: package.json (stdin). --argjson expected: { "@cosmicdrift/pkg": "1.2.3", ... }
# Output: comma-separated "name@wrong" for stale internal pins, or empty if ok.
((.dependencies // {}) + (.peerDependencies // {}))
| to_entries
| map(select(.key | startswith("@cosmicdrift/")))
| map(select(.value != $expected[.key]) | "\(.key)@\(.value)")
| join(", ")
