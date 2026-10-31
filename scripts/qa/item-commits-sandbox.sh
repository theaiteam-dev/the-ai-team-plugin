#!/usr/bin/env bash
# QA sandbox for the item-commits mission (WI-343).
#
# Gives Frankie a drivable CLI + git surface in one command:
#   - the branch's ateam CLI, built INTO the sandbox (never the dev or plugin binary)
#   - a scratch git repo on mission/sandbox with a bare remote named origin
#   - a dedicated project and a seeded mission with items on the QA API
#   - an initialised pool and a stub gh on PATH
#
# Requires the QA API (the kanban-viewer dev:qa script, port 5567) to be running.
# Usage: eval "$(scripts/qa/item-commits-sandbox.sh)"   # progress goes to stderr
#
# Env: ATEAM_API_URL (default http://localhost:5567). The live :5566 API is always refused.
#        Any other URL is refused unless SANDBOX_ALLOW_API_URL is set to that exact URL
#        (trailing slash ignored), because the script seeds a project, a --force mission
#        and items there. A stale value or SANDBOX_ALLOW_API_URL=1 does not approve a
#        different target.
#      SANDBOX (default under TMPDIR),
#      GH_STUB_AUTH=fail makes the stub's `gh auth status` fail.
#
# Baseline fixtures: before `ateam pool init`, the sandbox repo gets one modified tracked
# file (README.md) and one untracked file (notes/preexisting.txt), so the pool records them
# as baseline-dirty and Frankie can exercise baseline exclusion without re-initialising.
set -euo pipefail

# Never inherit a live mission/project: the pool dir (/tmp/.ateam-pool/<mission>)
# and API calls must only ever target the sandbox's own ids set below.
unset ATEAM_MISSION_ID ATEAM_PROJECT_ID

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEFAULT_API_URL="http://localhost:5567"
API_URL="${ATEAM_API_URL:-$DEFAULT_API_URL}"
API_URL="${API_URL%/}"
SANDBOX="${SANDBOX:-${TMPDIR:-/tmp}/ateam-item-commits-sandbox}"
PROJECT_ID="item-commits-sandbox"
SANDBOX_REPO="$SANDBOX/repo"
SANDBOX_REMOTE="$SANDBOX/origin.git"
SANDBOX_BIN="$SANDBOX/bin"
MARKER_NAME=".item-commits-sandbox"
PRD_PATH="$REPO_ROOT/prd/ready/item-commits.md"

log() { echo "[item-commits-sandbox] $*" >&2; }
die() { echo "[item-commits-sandbox] ERROR: $*" >&2; exit 1; }

# --- Preconditions: fail before touching anything -------------------------
# Target checks run first, before any network call. The live :5566 API is refused
# regardless of opt-in. Any other non-default URL needs SANDBOX_ALLOW_API_URL set to
# that exact URL, so an inherited ATEAM_API_URL (for example the hosted API) is never
# seeded by accident.
case "$API_URL" in
  *:5566|*:5566/*) die "refusing live API at ATEAM_API_URL=$API_URL (the sandbox uses the QA API on :5567)" ;;
esac
ALLOWED_API_URL="${SANDBOX_ALLOW_API_URL:-}"
ALLOWED_API_URL="${ALLOWED_API_URL%/}"
if [ "$API_URL" != "$DEFAULT_API_URL" ] && [ "$ALLOWED_API_URL" != "$API_URL" ]; then
  die "refusing ATEAM_API_URL=$API_URL: it is not the default $DEFAULT_API_URL. This script seeds a project, a --force mission and items there. To use it, set SANDBOX_ALLOW_API_URL=$API_URL"
fi
for tool in curl git go jq; do
  command -v "$tool" >/dev/null 2>&1 || die "required tool not found: $tool"
done
curl -fsS --max-time 5 "$API_URL/api/projects" >/dev/null 2>&1 \
  || die "QA API unreachable at ATEAM_API_URL=$API_URL (start the kanban-viewer dev:qa script)"

# Only delete a directory this script created: an existing SANDBOX must hold our marker.
# A nonexistent path is fine. This also covers trailing slashes, parents, relative
# paths, HOME, and dot-dot escapes, because none of those contain the marker.
if [ -e "$SANDBOX" ] && [ ! -f "$SANDBOX/$MARKER_NAME" ]; then
  die "refusing to delete '$SANDBOX': it exists and is not a sandbox created by this script"
fi

# --- Recreate the sandbox from scratch ------------------------------------
log "recreating sandbox at $SANDBOX"
rm -rf "$SANDBOX"
mkdir -p "$SANDBOX_BIN"
echo "created by scripts/qa/item-commits-sandbox.sh" > "$SANDBOX/$MARKER_NAME"

# --- Build the branch CLI into the sandbox --------------------------------
log "building packages/ateam-cli into $SANDBOX_BIN"
(cd "$REPO_ROOT/packages/ateam-cli" && go build -o "$SANDBOX_BIN/ateam" .) \
  || die "go build of packages/ateam-cli failed"

# --- Stub gh ---------------------------------------------------------------
cat > "$SANDBOX_BIN/gh" <<'STUB'
#!/usr/bin/env bash
# Stub gh: records every invocation, answers just enough for the pipeline.
sandbox="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
echo "$*" >> "$sandbox/gh-calls.log"
case "${1:-} ${2:-}" in
  "auth status")
    if [ "${GH_STUB_AUTH:-ok}" = "fail" ]; then
      echo "You are not logged into any GitHub hosts." >&2
      exit 1
    fi
    echo "Logged in to github.com (stub)"
    ;;
  "pr create")
    echo "https://github.com/example/item-commits-sandbox/pull/1"
    ;;
esac
exit 0
STUB
chmod +x "$SANDBOX_BIN/gh"
: > "$SANDBOX/gh-calls.log"

# --- Scratch git repo with a bare origin -----------------------------------
git init -q --bare "$SANDBOX_REMOTE"
git init -q -b mission/sandbox "$SANDBOX_REPO"
git -C "$SANDBOX_REPO" config user.name "Sandbox"
git -C "$SANDBOX_REPO" config user.email "sandbox@example.invalid"
git -C "$SANDBOX_REPO" config commit.gpgsign false
echo "# item-commits sandbox" > "$SANDBOX_REPO/README.md"
git -C "$SANDBOX_REPO" add README.md
git -C "$SANDBOX_REPO" commit -q -m "chore: initial sandbox commit"
git -C "$SANDBOX_REPO" remote add origin "$SANDBOX_REMOTE"
git -C "$SANDBOX_REPO" push -q -u origin mission/sandbox

# --- Seed project, mission, items ------------------------------------------
export PATH="$SANDBOX_BIN:$PATH"
export ATEAM_API_URL="$API_URL"
export ATEAM_PROJECT_ID="$PROJECT_ID"

if ! ateam projects getProject "$PROJECT_ID" >/dev/null 2>&1; then
  ateam projects createProject --id "$PROJECT_ID" --name "Item Commits Sandbox" >/dev/null \
    || die "could not create project $PROJECT_ID at ATEAM_API_URL=$API_URL"
fi

# --force archives any earlier sandbox mission, so reruns start clean.
MISSION_JSON="$(cd "$SANDBOX_REPO" && ateam missions createMission --name "item-commits sandbox" --prdPath "$PRD_PATH" --force --json)" \
  || die "could not create mission"
ATEAM_MISSION_ID="$(jq -r '.data.id // .id // .data.mission.id // empty' <<<"$MISSION_JSON")"
[ -n "$ATEAM_MISSION_ID" ] || die "mission id missing from createMission output: $MISSION_JSON"
export ATEAM_MISSION_ID

ITEM_IDS=()
create_item() { # title, file slug; appends the new item id to ITEM_IDS
  local out id
  out="$(ateam items createItem --title "$1" --type feature --priority medium \
    --description "Sandbox item for the item-commits Definition of Done." \
    --objective "$1 works in the sandbox repo." \
    --acceptance "$1 is committed to mission/sandbox" \
    --context "Sandbox fixture; files live in $SANDBOX_REPO." \
    --outputs.test "src/__tests__/$2.test.js" \
    --outputs.impl "src/$2.js" --json)" \
    || die "could not create item $1"
  id="$(jq -r '.data.id // .id // empty' <<<"$out")"
  [ -n "$id" ] || die "item id missing from createItem output for $1: $out"
  ITEM_IDS+=("$id")
}
create_item "Sandbox greeter" greeter
create_item "Sandbox farewell" farewell
create_item "Sandbox counter" counter
create_item "Sandbox parser" parser
create_item "Sandbox formatter" formatter

# Baseline-dirty fixtures: the pool snapshots the working tree at init, so make one
# tracked file modified and one file untracked first. Neither collides with item
# outputs (src/...), so item commits never include them.
BASELINE_FIXTURES=(README.md notes/preexisting.txt)
echo "# item-commits sandbox (locally modified before pool init)" >> "$SANDBOX_REPO/README.md"
mkdir -p "$SANDBOX_REPO/notes"
echo "untracked before pool init" > "$SANDBOX_REPO/notes/preexisting.txt"
log "baseline-dirty fixtures (modified: README.md, untracked: notes/preexisting.txt)"

(cd "$SANDBOX_REPO" && ateam pool init --single-use >/dev/null) || die "pool init failed"

# Agents only start items in ready/testing, so move the fixture off briefings.
# Moves run from the sandbox repo on mission/sandbox with the branch CLI, so the
# legacy moveItem-to-staged step makes its item commit there.
move_item() { # id, stage
  (cd "$SANDBOX_REPO" && ateam board-move moveItem --itemId "$1" --toStage "$2" >/dev/null) \
    || die "could not move $1 to $2"
}
for id in "${ITEM_IDS[@]}"; do move_item "$id" ready; done

# Second item stays in probing: its staging step is still to run.
move_item "${ITEM_IDS[1]}" probing

# First item reaches staged with its declared output written but uncommitted,
# so the legacy move produces an item commit.
mkdir -p "$SANDBOX_REPO/src"
echo "module.exports = () => 'hello from the sandbox';" > "$SANDBOX_REPO/src/greeter.js"
move_item "${ITEM_IDS[0]}" probing
move_item "${ITEM_IDS[0]}" staged

# The remaining items (counter, parser, formatter) stay in ready.
FINAL_STAGES=(staged probing ready ready ready)
log "fixture items, one per line with its final stage:"
for i in "${!ITEM_IDS[@]}"; do
  log "${ITEM_IDS[$i]} ${FINAL_STAGES[$i]}"
done

log "baseline-dirty paths: ${BASELINE_FIXTURES[*]}"
log "ready. gh calls are logged to $SANDBOX/gh-calls.log"
cat <<OUT
# baseline-dirty fixtures: ${BASELINE_FIXTURES[*]}
export ATEAM_API_URL='$ATEAM_API_URL'
export ATEAM_PROJECT_ID='$ATEAM_PROJECT_ID'
export ATEAM_MISSION_ID='$ATEAM_MISSION_ID'
export SANDBOX='$SANDBOX'
export SANDBOX_REPO='$SANDBOX_REPO'
export PATH='$SANDBOX_BIN':"\$PATH"
OUT
