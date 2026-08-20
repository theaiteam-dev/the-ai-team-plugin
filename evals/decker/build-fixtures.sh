#!/usr/bin/env bash
# Builds 5 fixture repos. Each: commit the "before" as base, leave the
# proposed change (with a planted bug, or clean) in the working tree so
# `git diff` shows the change under review.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)/fixtures"
rm -rf "$ROOT"
mkdir -p "$ROOT"

init() { # $1 = dir
  local d="$ROOT/$1"; mkdir -p "$d"; git -C "$d" init -q
  git -C "$d" config user.email decker@eval.local
  git -C "$d" config user.name decker-eval
}
commit_base() { local d="$ROOT/$1"; git -C "$d" add -A; git -C "$d" commit -qm base; }

########################################################################
# 01 — fix-that-patched-one-spelling: sed -i blocked, sed -Ei bypasses
########################################################################
init 01-sed
cat > "$ROOT/01-sed/guard.js" <<'EOF'
// Blocks in-place edits to protected.txt. Usage: node guard.js '<bash command>'
// exit 2 = blocked, exit 0 = allowed.
const cmd = process.argv[2] || "";
const tokens = cmd.trim().split(/\s+/);
const isProtected = tokens.includes("protected.txt");
// (base version: no in-place detection at all — every sed was allowed)
if (tokens[0] === "sed" && isProtected) { process.exit(2); }
process.exit(0);
EOF
commit_base 01-sed
# proposed change: add in-place detection — but only matches -i / --in-place
cat > "$ROOT/01-sed/guard.js" <<'EOF'
// Blocks in-place edits to protected.txt. Usage: node guard.js '<bash command>'
// exit 2 = blocked, exit 0 = allowed.
const cmd = process.argv[2] || "";
const tokens = cmd.trim().split(/\s+/);
const isProtected = tokens.includes("protected.txt");
const hasInPlace = tokens.some((t) => /^(?:-i|--in-place)/.test(t));
if (tokens[0] === "sed" && hasInPlace && isProtected) { process.exit(2); }
process.exit(0);
EOF
echo "do not edit in place" > "$ROOT/01-sed/protected.txt"

########################################################################
# 02 — refinement-weaker-than-fallback: absent postcheck now passes
########################################################################
init 02-postcheck
cat > "$ROOT/02-postcheck/gate.js" <<'EOF'
// decide(mission) -> "BLOCK" | "PASS". A mission may pass only once its
// postcheck has recorded a pass.
function decide(mission) {
  const pc = mission.postcheck; // absent key => undefined => BLOCK (fail closed)
  if (!pc || !pc.passed) return "BLOCK";
  return "PASS";
}
module.exports = { decide };
EOF
commit_base 02-postcheck
# proposed change: "normalize" the mission, synthesizing postcheck from state
cat > "$ROOT/02-postcheck/gate.js" <<'EOF'
// decide(mission) -> "BLOCK" | "PASS". A mission may pass only once its
// postcheck has recorded a pass.
function normalize(mission) {
  return {
    ...mission,
    // fill in a default when the field is absent
    postcheck: "postcheck" in mission ? mission.postcheck : { passed: mission.state === "completed" },
  };
}
function decide(mission) {
  const m = normalize(mission);
  if (!m.postcheck || !m.postcheck.passed) return "BLOCK";
  return "PASS";
}
module.exports = { decide, normalize };
EOF

########################################################################
# 03 — interaction-across-files: producer key rename, consumer stale read
########################################################################
init 03-cipher
cat > "$ROOT/03-cipher/producer.js" <<'EOF'
// Produces the shop config consumed by consumer.js
function buildConfig() {
  return { shopCipher: "CIPHER-abc123", region: "US" };
}
module.exports = { buildConfig };
EOF
cat > "$ROOT/03-cipher/consumer.js" <<'EOF'
const { buildConfig } = require("./producer");
// Signs a request; the cipher MUST be present or the signature is invalid.
function signRequest() {
  const cfg = buildConfig();
  const cipher = cfg.shopCipher;
  return { signed: true, cipher, valid: Boolean(cipher) };
}
if (require.main === module) console.log(JSON.stringify(signRequest()));
module.exports = { signRequest };
EOF
commit_base 03-cipher
# proposed change: producer renames its output key; consumer untouched
cat > "$ROOT/03-cipher/producer.js" <<'EOF'
// Produces the shop config consumed by consumer.js
function buildConfig() {
  // renamed shopCipher -> shop_cipher for cross-service consistency
  return { shop_cipher: "CIPHER-abc123", region: "US" };
}
module.exports = { buildConfig };
EOF

########################################################################
# 04 — guard traversal: startsWith('/tmp/') allows /tmp/../etc
########################################################################
init 04-traversal
cat > "$ROOT/04-traversal/writeguard.js" <<'EOF'
// Allows writes only inside the scratch area. Usage: node writeguard.js <path>
// exit 0 = allowed, exit 2 = blocked.
const p = process.argv[2] || "";
// (base: canonicalize first)
const path = require("path");
const abs = path.resolve(p);
if (abs.startsWith("/tmp/")) process.exit(0);
process.exit(2);
EOF
commit_base 04-traversal
# proposed change: "simplify" — drop the resolve, check the raw string
cat > "$ROOT/04-traversal/writeguard.js" <<'EOF'
// Allows writes only inside the scratch area. Usage: node writeguard.js <path>
// exit 0 = allowed, exit 2 = blocked.
const p = process.argv[2] || "";
if (p.startsWith("/tmp/")) process.exit(0);
process.exit(2);
EOF

########################################################################
# 05 — CLEAN CONTROL: a correct, well-tested change; no defect
########################################################################
init 05-clean
cat > "$ROOT/05-clean/clamp.js" <<'EOF'
// clamp(n, lo, hi): constrain a finite number n to [lo, hi]. Callers pass
// validated finite numbers with lo <= hi (enforced upstream).
function clamp(n, lo, hi) {
  return Math.min(Math.max(n, lo), hi);
}
module.exports = { clamp };
EOF
cat > "$ROOT/05-clean/clamp.test.js" <<'EOF'
const assert = require("assert");
const { clamp } = require("./clamp");
assert.strictEqual(clamp(5, 0, 10), 5);
assert.strictEqual(clamp(-3, 0, 10), 0);
assert.strictEqual(clamp(99, 0, 10), 10);
assert.strictEqual(clamp(0, 0, 10), 0);
assert.strictEqual(clamp(10, 0, 10), 10);
console.log("ok");
EOF
commit_base 05-clean
# proposed change: extend the SAME contract with an inclusive-range helper,
# correct and tested. No defect planted.
cat > "$ROOT/05-clean/clamp.js" <<'EOF'
// clamp(n, lo, hi): constrain a finite number n to [lo, hi]. Callers pass
// validated finite numbers with lo <= hi (enforced upstream).
function clamp(n, lo, hi) {
  return Math.min(Math.max(n, lo), hi);
}
// inRange(n, lo, hi): true iff n is within [lo, hi], inclusive. Same caller
// contract as clamp (finite numbers, lo <= hi).
function inRange(n, lo, hi) {
  return n >= lo && n <= hi;
}
module.exports = { clamp, inRange };
EOF
cat > "$ROOT/05-clean/clamp.test.js" <<'EOF'
const assert = require("assert");
const { clamp, inRange } = require("./clamp");
assert.strictEqual(clamp(5, 0, 10), 5);
assert.strictEqual(clamp(-3, 0, 10), 0);
assert.strictEqual(clamp(99, 0, 10), 10);
assert.strictEqual(clamp(0, 0, 10), 0);
assert.strictEqual(clamp(10, 0, 10), 10);
assert.strictEqual(inRange(5, 0, 10), true);
assert.strictEqual(inRange(0, 0, 10), true);
assert.strictEqual(inRange(10, 0, 10), true);
assert.strictEqual(inRange(-1, 0, 10), false);
assert.strictEqual(inRange(11, 0, 10), false);
console.log("ok");
EOF

echo "built fixtures:"; ls "$ROOT"
