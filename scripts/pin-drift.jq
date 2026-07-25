# Pin-drift guard (#410, #498-adjacent). Reads a packed package.json on stdin and
# `$expected` (a {"@cosmicdrift/<pkg>": "<version>"} map of the release set). Emits
# a comma-joined list of internal @cosmicdrift/* deps whose pinned version differs
# from that dependency's actual release version — empty string means clean.
#
# Compares each pin against the DEPENDENCY's version, not the depending package's:
# cli runs an independent version line (0.2.x) yet correctly pins dev-server@0.67.x.
# Deps outside the workspace ($expected[.key] == null) are external pins → skipped.
#
# peerDependencies pin `workspace:^` (range, not exact) — `bun pm pack` substitutes
# that to `^<version>` (#1529). Strip a leading `^`/`~` before comparing so a
# range-pinned peer at the release version isn't flagged as drift; dependencies/
# optionalDependencies stay exact-compared (those pin `workspace:*` → exact).
def stripCaret: sub("^[\\^~]"; "");

(
  ((.dependencies // {}) | to_entries | map(. + { exact: true }))
  + ((.peerDependencies // {}) | to_entries | map(. + { exact: false }))
  + ((.optionalDependencies // {}) | to_entries | map(. + { exact: true }))
)
| map(
    select(.key | startswith("@cosmicdrift/"))
    | select($expected[.key] != null)
    | . as $e
    | (if $e.exact then $e.value else ($e.value | stripCaret) end) as $cmp
    | select($cmp != $expected[$e.key])
    | "\($e.key)@\($e.value) (expected \($expected[$e.key]))"
  )
| join(", ")
