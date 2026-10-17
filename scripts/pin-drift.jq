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
# A peer that is not a plain version (e.g. ">=0.353.0 <1.0.0") is an explicit
# range: it drifts when its lower bound (">=X.Y.Z") is above the release version,
# when the release version reaches its upper bound ("<X.Y.Z" / "<=X.Y.Z"), or when
# no ">=" lower bound is recognizable ("*", "0.x", "||" unions).
def stripCaret: sub("^[\\^~]"; "");
def isPlainVersion: test("^[\\^~]?[0-9]+\\.[0-9]+\\.[0-9]+([-+][0-9A-Za-z.+-]*)?$");
def semverParts: capture("(?<a>[0-9]+)\\.(?<b>[0-9]+)\\.(?<c>[0-9]+)") | [.a, .b, .c] | map(tonumber);
def rangeBounds($pattern): [scan($pattern) | .[0] | semverParts];
def rangeDrifts($expectedVersion):
  ($expectedVersion | semverParts) as $want
  | rangeBounds(">=\\s*([0-9]+\\.[0-9]+\\.[0-9]+)") as $lowers
  | rangeBounds("<\\s*([0-9]+\\.[0-9]+\\.[0-9]+)") as $uppersExclusive
  | rangeBounds("<=\\s*([0-9]+\\.[0-9]+\\.[0-9]+)") as $uppersInclusive
  | ($lowers | length) == 0
    or any($lowers[]; . > $want)
    or any($uppersExclusive[]; . <= $want)
    or any($uppersInclusive[]; . < $want);

(
  ((.dependencies // {}) | to_entries | map(. + { exact: true }))
  + ((.peerDependencies // {}) | to_entries | map(. + { exact: false }))
  + ((.optionalDependencies // {}) | to_entries | map(. + { exact: true }))
)
| map(
    select(.key | startswith("@cosmicdrift/"))
    | select($expected[.key] != null)
    | . as $e
    | select($e.exact or ($e.value | isPlainVersion) or ($e.value | rangeDrifts($expected[$e.key])))
    | (if $e.exact then $e.value else ($e.value | stripCaret) end) as $cmp
    | select($cmp != $expected[$e.key])
    | "\($e.key)@\($e.value) (expected \($expected[$e.key]))"
  )
| join(", ")
