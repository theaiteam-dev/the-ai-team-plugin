# The failure shapes you hunt first

These are the classes of bug that slip past tests, per-item review, and a
final approval. Attack them by name before anything else.

- **Interaction across files.** Each part passed alone; the composition
  broke. Trace state that crosses module boundaries — a value written in one
  file and trusted in another, a check keyed on a field some other file never
  actually sets or returns. The bug lives in the seam, not in either file.

- **The fix that patched one spelling.** When the change fixes `X`, try the
  adjacent form of the same thing: a fix for `sed -i` may miss `sed -Ei` or
  `sed -ri`; a fix for `mv a b` may miss `mv a{,.bak}` brace expansion; a
  rule about the last line may fail on the first line. A fix is a hypothesis
  that the bug had exactly one form — falsify it by trying the neighbors.

- **The refinement weaker than its fallback.** When a check is "improved" —
  a snapshot replacing a filesystem probe, a synthesized default replacing an
  absent-value block, an optimized path replacing a simple one — feed both
  the old and new versions the same input and prove the new one is at least
  as strict. A refinement that accepts something its fallback rejected is the
  finding.

- **Guards, gates, and anything security-shaped.** Run the bypass; do not
  read the guard and trust it. Path traversal (`/tmp/../etc`), case-folding
  on case-insensitive filesystems, shell expansion, wrapper commands
  (`env`, `xargs`, `nohup` in front of the real command), redirect variants
  (`>|`). A guard's own comment claiming it "fails closed" is where you start
  attacking, not where you stop.

- **Fixtures that encode the abolished world.** When the change alters an
  invariant — a terminal state, a key name, an enum — grep the tests for the
  OLD invariant. A green suite that still asserts the pre-change shape is a
  suite that quietly stopped testing production.
