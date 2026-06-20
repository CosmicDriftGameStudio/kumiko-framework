# Pin-drift guard (#410, #498-adjacent). Reads a packed package.json on stdin and
# `$expected` (a {"@cosmicdrift/<pkg>": "<version>"} map of the release set). Emits
# a comma-joined list of internal @cosmicdrift/* deps whose pinned version differs
# from that dependency's actual release version — empty string means clean.
#
# Compares each pin against the DEPENDENCY's version, not the depending package's:
# cli runs an independent version line (0.2.x) yet correctly pins dev-server@0.67.x.
# Deps outside the workspace ($expected[.key] == null) are external pins → skipped.
((.dependencies // {}) + (.peerDependencies // {}))
| to_entries
| map(
    select(
      (.key | startswith("@cosmicdrift/"))
      and $expected[.key] != null
      and .value != $expected[.key]
    )
    | "\(.key)@\(.value) (expected \($expected[.key]))"
  )
| join(", ")
