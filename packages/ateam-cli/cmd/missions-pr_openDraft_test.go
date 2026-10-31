package cmd

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/spf13/pflag"
)

// WI-337: `ateam missions-pr openDraft` pushes the mission branch (the one
// recorded in <poolDir>/branch, not the current HEAD) and opens a DRAFT PR
// with `gh pr create --draft --title <first line of pr-description.md>
// --head <branch> --body-file <pr-description.md>`.
//
// Harness: temp git repo as cwd, bare repo in a temp dir as "origin", and a
// stub `gh` shell script first on PATH. The real gh and GitHub are never
// touched. The stub logs every call (argv) and is steered by marker files in
// its directory:
//   auth_fail    -> `gh auth status` exits 1
//   existing_url -> `gh pr view` / `gh pr list` report an open PR with that URL
//                   (plain URL when called with -q/--jq, JSON otherwise)
//   closed_url   -> a closed or merged PR with that URL exists for the branch.
//                   `gh pr view` still finds it (as real gh does); `gh pr list`
//                   shows it only for --state closed, merged or all.
//   create_fail  -> `gh pr create` exits 1
// When no PR exists `gh pr view` exits 1 and `gh pr list` prints nothing/[].

const stubGhScript = `#!/bin/sh
D="$(dirname "$0")"
{ for a in "$@"; do printf '%s\0' "$a"; done; printf '\001'; } >> "$D/gh.log"
jq=0
state=open
prev=""
for a in "$@"; do
  case "$a" in -q|--jq) jq=1;; esac
  if [ "$prev" = "--state" ] || [ "$prev" = "-s" ]; then state="$a"; fi
  prev="$a"
done
case "$1 $2" in
"auth status")
  if [ -e "$D/auth_fail" ]; then echo "You are not logged into any GitHub hosts" >&2; exit 1; fi
  exit 0;;
"pr view")
  if [ -e "$D/existing_url" ]; then
    url=$(cat "$D/existing_url")
    if [ $jq = 1 ]; then echo "$url"; else echo "{\"url\":\"$url\"}"; fi
    exit 0
  fi
  if [ -e "$D/closed_url" ]; then
    url=$(cat "$D/closed_url")
    if [ $jq = 1 ]; then echo "$url"; else echo "{\"url\":\"$url\"}"; fi
    exit 0
  fi
  echo "no pull requests found for branch" >&2; exit 1;;
"pr list")
  url=""
  case "$state" in
    open) [ -e "$D/existing_url" ] && url=$(cat "$D/existing_url");;
    closed|merged) [ -e "$D/closed_url" ] && url=$(cat "$D/closed_url");;
    all) if [ -e "$D/existing_url" ]; then url=$(cat "$D/existing_url"); elif [ -e "$D/closed_url" ]; then url=$(cat "$D/closed_url"); fi;;
  esac
  if [ -n "$url" ]; then
    if [ $jq = 1 ]; then echo "$url"; else echo "[{\"url\":\"$url\"}]"; fi
    exit 0
  fi
  if [ $jq = 1 ]; then :; else echo "[]"; fi
  exit 0;;
"pr create")
  prev=""
  for a in "$@"; do
    if [ "$prev" = "--body-file" ]; then cp "$a" "$D/body.copy" 2>/dev/null; fi
    prev="$a"
  done
  if [ -e "$D/create_fail" ]; then echo "GraphQL: boom" >&2; exit 1; fi
  echo "https://github.com/acme/widgets/pull/7"
  exit 0;;
esac
echo "stub gh: unexpected call: $*" >&2
exit 2
`

const (
	odBranch     = "mission/item-commits"
	odCreatedURL = "https://github.com/acme/widgets/pull/7"
	odExistURL   = "https://github.com/acme/widgets/pull/42"
	odTitle      = "Per-item commits"
)

type odEnv struct {
	root    string
	remote  string // bare repo path ("" when no remote)
	poolDir string
	binDir  string
	srvURL  string
	mission string
}

type odOpts struct {
	noRemote bool
}

// odSetup builds the repo (on odBranch, one commit ahead of main), remote,
// pool dir with the recorded branch, pr-description.md, stub gh and fake API.
func odSetup(t *testing.T, o odOpts) *odEnv {
	t.Helper()
	missionID, poolDir := withTempPoolRoot(t, "opendraft")
	t.Setenv("ATEAM_PROJECT_ID", "")
	// Isolate from the operator's git config (e.g. core.hooksPath) so the
	// command's child git processes behave the same on every machine.
	t.Setenv("GIT_CONFIG_GLOBAL", os.DevNull)
	t.Setenv("GIT_CONFIG_NOSYSTEM", "1")
	t.Setenv("HOME", t.TempDir())
	root := chdirToRepo(t, odBranch)
	writePRFile(t, filepath.Join(root, "feature.txt"), "mission work\n")
	poolGit(t, root, "add", ".")
	poolGit(t, root, "commit", "-m", "mission commit")

	e := &odEnv{root: root, poolDir: poolDir, mission: missionID}
	if !o.noRemote {
		e.remote = filepath.Join(t.TempDir(), "origin.git")
		poolGit(t, root, "init", "--bare", "-b", "main", e.remote)
		poolGit(t, root, "remote", "add", "origin", e.remote)
	}
	if err := os.MkdirAll(poolDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(poolDir, "branch"), []byte(odBranch+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	writePRFile(t, odDescPath(e), odTitle+"\n\nBody text.\n\nMission: "+missionID+"\nPRD: item-commits\n")

	e.binDir = t.TempDir()
	if err := os.WriteFile(filepath.Join(e.binDir, "gh"), []byte(stubGhScript), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", e.binDir+string(os.PathListSeparator)+os.Getenv("PATH"))

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/api/missions/current" {
			b, _ := json.Marshal(map[string]interface{}{"success": true, "data": map[string]interface{}{
				"id": missionID, "name": odTitle, "prdPath": prPRDPath, "state": "running",
			}})
			_, _ = w.Write(b)
			return
		}
		w.WriteHeader(404)
		_, _ = w.Write([]byte(`{"success":false}`))
	}))
	t.Cleanup(srv.Close)
	e.srvURL = srv.URL
	return e
}

func odDescPath(e *odEnv) string {
	return filepath.Join(e.root, ".qa-evidence", e.mission, "pr-description.md")
}

func (e *odEnv) marker(t *testing.T, name, content string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(e.binDir, name), []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func (e *odEnv) writeConfig(t *testing.T, content string) {
	t.Helper()
	writePRFile(t, filepath.Join(e.root, "ateam.config.json"), content)
}

// ghCalls returns every recorded gh invocation as its argv.
func (e *odEnv) ghCalls(t *testing.T) [][]string {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(e.binDir, "gh.log"))
	if err != nil {
		return nil
	}
	var calls [][]string
	for _, rec := range strings.Split(string(raw), "\x01") {
		if rec == "" {
			continue
		}
		args := strings.Split(strings.TrimSuffix(rec, "\x00"), "\x00")
		calls = append(calls, args)
	}
	return calls
}

func (e *odEnv) createCalls(t *testing.T) [][]string {
	t.Helper()
	var out [][]string
	for _, c := range e.ghCalls(t) {
		if len(c) >= 2 && c[0] == "pr" && c[1] == "create" {
			out = append(out, c)
		}
	}
	return out
}

func argAfter(args []string, flag string) (string, bool) {
	for i, a := range args {
		if a == flag && i+1 < len(args) {
			return args[i+1], true
		}
	}
	return "", false
}

// remoteRef returns the sha of refs/heads/<branch> on the bare remote, or "".
func (e *odEnv) remoteRef(t *testing.T, branch string) string {
	t.Helper()
	if e.remote == "" {
		return ""
	}
	out, err := exec.Command("git", "--git-dir", e.remote, "rev-parse", "--verify", "--quiet", "refs/heads/"+branch).Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

func (e *odEnv) localSha(t *testing.T, ref string) string {
	t.Helper()
	out, err := exec.Command("git", "-C", e.root, "rev-parse", ref).Output()
	if err != nil {
		t.Fatalf("rev-parse %s: %v", ref, err)
	}
	return strings.TrimSpace(string(out))
}

func (e *odEnv) run(t *testing.T) (string, error) {
	t.Helper()
	resetPersistentFlags(t)
	var buf bytes.Buffer
	rootCmd.SetOut(&buf)
	rootCmd.SetErr(&buf)
	rootCmd.SetArgs([]string{"missions-pr", "openDraft", "--base-url", e.srvURL, "--no-color"})
	err := rootCmd.Execute()
	return buf.String(), err
}

func (e *odEnv) runOK(t *testing.T) string {
	t.Helper()
	out, err := e.run(t)
	if err != nil {
		t.Fatalf("openDraft failed: %v\n%s", err, out)
	}
	return out
}

// manualCommandLine returns the printed line that starts with "gh pr create".
func manualCommandLine(t *testing.T, out string) string {
	t.Helper()
	for _, line := range strings.Split(out, "\n") {
		if l := strings.TrimSpace(line); strings.HasPrefix(l, "gh pr create") {
			return l
		}
	}
	t.Fatalf("no 'gh pr create' command line in output:\n%s", out)
	return ""
}

// ---- happy path ----

func TestOpenDraftPushesBranchAndCreatesDraftPR(t *testing.T) {
	e := odSetup(t, odOpts{})
	out := e.runOK(t)

	if got, want := e.remoteRef(t, odBranch), e.localSha(t, odBranch); got != want {
		t.Fatalf("remote %s = %q, want %q (branch not pushed)", odBranch, got, want)
	}
	creates := e.createCalls(t)
	if len(creates) != 1 {
		t.Fatalf("want exactly one 'gh pr create', got %d: %v", len(creates), creates)
	}
	args := creates[0]
	hasDraft := false
	for _, a := range args {
		if a == "--draft" {
			hasDraft = true
		}
	}
	if !hasDraft {
		t.Errorf("gh pr create must pass --draft: %v", args)
	}
	if title, _ := argAfter(args, "--title"); title != odTitle {
		t.Errorf("--title = %q, want first line of description %q", title, odTitle)
	}
	if body, _ := argAfter(args, "--body-file"); body != odDescPath(e) {
		t.Errorf("--body-file = %q, want %q", body, odDescPath(e))
	}
	if head, _ := argAfter(args, "--head"); head != odBranch {
		t.Errorf("--head = %q, want recorded branch %q", head, odBranch)
	}
	if !strings.Contains(out, odCreatedURL) {
		t.Errorf("output must print the PR URL %s:\n%s", odCreatedURL, out)
	}
}

func TestOpenDraftBodyIsTheGeneratedFileContentNotRegenerated(t *testing.T) {
	e := odSetup(t, odOpts{})
	custom := odTitle + "\n\nHAND-EDITED-MARKER\n\nMission: " + e.mission + "\nPRD: item-commits\n"
	writePRFile(t, odDescPath(e), custom)
	e.runOK(t)
	got, err := os.ReadFile(filepath.Join(e.binDir, "body.copy"))
	if err != nil {
		t.Fatalf("gh never received a readable body file: %v", err)
	}
	if string(got) != custom {
		t.Errorf("body file content changed or regenerated:\n%q", got)
	}
}

func TestOpenDraftPushesRecordedBranchNotCurrentHead(t *testing.T) {
	e := odSetup(t, odOpts{})
	poolGit(t, e.root, "checkout", "-b", "scratch/other", "main")
	writePRFile(t, filepath.Join(e.root, "other.txt"), "unrelated\n")
	poolGit(t, e.root, "add", ".")
	poolGit(t, e.root, "commit", "-m", "unrelated work")
	e.runOK(t)

	if got, want := e.remoteRef(t, odBranch), e.localSha(t, odBranch); got != want {
		t.Errorf("recorded branch not pushed: remote=%q want %q", got, want)
	}
	if got := e.remoteRef(t, "scratch/other"); got != "" {
		t.Errorf("current HEAD branch must not be pushed, remote has %q", got)
	}
	creates := e.createCalls(t)
	if len(creates) != 1 {
		t.Fatalf("want one create, got %v", creates)
	}
	if head, _ := argAfter(creates[0], "--head"); head != odBranch {
		t.Errorf("--head = %q, want %q", head, odBranch)
	}
}

// ---- config switch ----

func TestOpenDraftConfigOpenFalseOpensNothingAndPrintsManualCommand(t *testing.T) {
	e := odSetup(t, odOpts{})
	e.writeConfig(t, `{"pullRequest":{"open":false}}`)
	out := e.runOK(t)

	if got := e.remoteRef(t, odBranch); got != "" {
		t.Errorf("nothing may be pushed when pullRequest.open is false, remote has %q", got)
	}
	if n := len(e.ghCalls(t)); n != 0 {
		t.Errorf("gh must not be invoked at all when opening is off, got %v", e.ghCalls(t))
	}
	if !strings.Contains(out, odDescPath(e)) {
		t.Errorf("output must name the description file %s:\n%s", odDescPath(e), out)
	}
	manualCommandLine(t, out)
	if !strings.Contains(out, "pullRequest.open") {
		t.Errorf("output must name the config switch pullRequest.open as the reason:\n%s", out)
	}
}

func TestOpenDraftConfigWithoutPullRequestBlockDefaultsToOpen(t *testing.T) {
	e := odSetup(t, odOpts{})
	e.writeConfig(t, `{"qa":{"anything":true}}`)
	e.runOK(t)
	if len(e.createCalls(t)) != 1 {
		t.Errorf("missing pullRequest block must default to on; creates=%v", e.createCalls(t))
	}
}

func TestOpenDraftConfigOpenTrueOpens(t *testing.T) {
	e := odSetup(t, odOpts{})
	e.writeConfig(t, `{"pullRequest":{"open":true}}`)
	e.runOK(t)
	if len(e.createCalls(t)) != 1 {
		t.Errorf("open:true must open the PR; creates=%v", e.createCalls(t))
	}
}

func TestOpenDraftConfigIsReadFromRepoRootWhenRunFromSubdirectory(t *testing.T) {
	e := odSetup(t, odOpts{})
	e.writeConfig(t, `{"pullRequest":{"open":false}}`)
	sub := filepath.Join(e.root, "deep", "dir")
	if err := os.MkdirAll(sub, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Chdir(sub); err != nil {
		t.Fatal(err)
	}
	e.runOK(t)
	if len(e.ghCalls(t)) != 0 || e.remoteRef(t, odBranch) != "" {
		t.Errorf("repo-root config ignored from a subdirectory: gh=%v", e.ghCalls(t))
	}
}

func TestRepoConfigDeclaresPullRequestOpenTrue(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "ateam.config.json"))
	if err != nil {
		t.Fatalf("read repo ateam.config.json: %v", err)
	}
	var cfg struct {
		PullRequest *struct {
			Open *bool `json:"open"`
		} `json:"pullRequest"`
	}
	if err := json.Unmarshal(raw, &cfg); err != nil {
		t.Fatalf("ateam.config.json is not valid JSON: %v", err)
	}
	if cfg.PullRequest == nil || cfg.PullRequest.Open == nil || !*cfg.PullRequest.Open {
		t.Errorf(`ateam.config.json must contain "pullRequest": { "open": true }`)
	}
}

// ---- blocked: no remote / gh missing / gh unauthenticated ----

func TestOpenDraftNoRemotePrintsManualCommandAndSucceeds(t *testing.T) {
	e := odSetup(t, odOpts{noRemote: true})
	out := e.runOK(t)

	if len(e.createCalls(t)) != 0 {
		t.Errorf("no PR may be created without a remote")
	}
	if !strings.Contains(out, odDescPath(e)) {
		t.Errorf("output must name the description file:\n%s", out)
	}
	manualCommandLine(t, out)
	if !strings.Contains(strings.ToLower(out), "remote") {
		t.Errorf("output must say the remote is what is missing:\n%s", out)
	}
}

func TestOpenDraftGhNotAuthenticatedPrintsManualCommandAndSucceeds(t *testing.T) {
	e := odSetup(t, odOpts{})
	e.marker(t, "auth_fail", "1")
	out := e.runOK(t)

	if len(e.createCalls(t)) != 0 {
		t.Errorf("no PR may be created when gh auth status fails")
	}
	if !strings.Contains(out, odDescPath(e)) {
		t.Errorf("output must name the description file:\n%s", out)
	}
	manualCommandLine(t, out)
	if !strings.Contains(strings.ToLower(out), "auth") {
		t.Errorf("output must say gh is not authenticated:\n%s", out)
	}
}

func TestOpenDraftGhNotInstalledPrintsManualCommandAndSucceeds(t *testing.T) {
	e := odSetup(t, odOpts{})
	// PATH holds only git, so `gh` cannot be found.
	gitPath, err := exec.LookPath("git")
	if err != nil {
		t.Skip("git not on PATH")
	}
	bare := t.TempDir()
	if err := os.Symlink(gitPath, filepath.Join(bare, "git")); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", bare)
	out := e.runOK(t)

	if !strings.Contains(out, odDescPath(e)) {
		t.Errorf("output must name the description file:\n%s", out)
	}
	manualCommandLine(t, out)
	if !strings.Contains(strings.ToLower(out), "gh") {
		t.Errorf("output must say gh is unavailable:\n%s", out)
	}
}

// ---- push failure ----

func TestOpenDraftPushFailureErrorsAndDoesNotCreatePR(t *testing.T) {
	e := odSetup(t, odOpts{})
	hook := filepath.Join(e.remote, "hooks", "pre-receive")
	if err := os.MkdirAll(filepath.Dir(hook), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(hook, []byte("#!/bin/sh\necho rejected-by-policy >&2\nexit 1\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	out, err := e.run(t)
	if err == nil {
		t.Fatalf("a failed push must be a command error, got success:\n%s", out)
	}
	if len(e.createCalls(t)) != 0 {
		t.Errorf("gh pr create must not run after a failed push")
	}
	if !strings.Contains(strings.ToLower(out+err.Error()), "push") {
		t.Errorf("error must mention the push:\n%s\n%v", out, err)
	}
}

func TestOpenDraftUnreachableRemoteErrorsAndDoesNotCreatePR(t *testing.T) {
	e := odSetup(t, odOpts{})
	poolGit(t, e.root, "remote", "set-url", "origin", filepath.Join(t.TempDir(), "does-not-exist.git"))
	if out, err := e.run(t); err == nil {
		t.Fatalf("unreachable remote must be a command error:\n%s", out)
	}
	if len(e.createCalls(t)) != 0 {
		t.Errorf("gh pr create must not run after a failed push")
	}
}

func TestOpenDraftGhCreateFailureIsReportedAsError(t *testing.T) {
	e := odSetup(t, odOpts{})
	e.marker(t, "create_fail", "1")
	out, err := e.run(t)
	if err == nil {
		t.Fatalf("gh pr create failure must surface as an error:\n%s", out)
	}
	if strings.Contains(out, odCreatedURL) {
		t.Errorf("must not print a PR URL when creation failed:\n%s", out)
	}
}

// ---- existing PR ----

func TestOpenDraftExistingPRPrintsURLAndCreatesNoSecond(t *testing.T) {
	e := odSetup(t, odOpts{})
	e.marker(t, "existing_url", odExistURL)
	out := e.runOK(t)

	if n := len(e.createCalls(t)); n != 0 {
		t.Errorf("must not create a second PR, got %d create calls", n)
	}
	if !strings.Contains(out, odExistURL) {
		t.Errorf("output must print the existing PR URL %s:\n%s", odExistURL, out)
	}
}

// `gh pr view <branch>` also returns closed and merged PRs. A branch whose only
// PR is closed still needs a new draft PR.
func TestOpenDraftClosedOrMergedPRDoesNotSuppressCreate(t *testing.T) {
	e := odSetup(t, odOpts{})
	e.marker(t, "closed_url", odExistURL)
	out := e.runOK(t)

	if n := len(e.createCalls(t)); n != 1 {
		t.Fatalf("a closed PR must not block creating a draft, got %d create calls\n%s", n, out)
	}
	if !strings.Contains(out, odCreatedURL) {
		t.Errorf("output must print the new PR URL %s:\n%s", odCreatedURL, out)
	}
	if strings.Contains(out, "already exists") {
		t.Errorf("must not claim a PR already exists:\n%s", out)
	}
}

func TestOpenDraftExistingPRLookupAsksOnlyForOpenPRsOnTheBranch(t *testing.T) {
	e := odSetup(t, odOpts{})
	e.runOK(t)
	var found bool
	for _, call := range e.ghCalls(t) {
		if len(call) >= 2 && call[0] == "pr" && call[1] == "list" {
			found = true
			joined := strings.Join(call, " ")
			if !strings.Contains(joined, "--head "+odBranch) || !strings.Contains(joined, "--state open") {
				t.Errorf("lookup must use --head %s --state open, got %q", odBranch, joined)
			}
		}
	}
	if !found {
		t.Error("expected a gh pr list lookup")
	}
}

func TestOpenDraftRerunAfterSuccessIsHarmless(t *testing.T) {
	e := odSetup(t, odOpts{})
	e.runOK(t)
	e.marker(t, "existing_url", odCreatedURL)
	out := e.runOK(t)
	if n := len(e.createCalls(t)); n != 1 {
		t.Errorf("second run must not create again, total creates = %d", n)
	}
	if !strings.Contains(out, odCreatedURL) {
		t.Errorf("second run must print the existing URL:\n%s", out)
	}
}

// ---- never ready / merge ----

func TestOpenDraftNeverRunsGhPrReadyOrMerge(t *testing.T) {
	for _, setup := range []func(*testing.T, *odEnv){
		func(*testing.T, *odEnv) {},
		func(t *testing.T, e *odEnv) { e.marker(t, "existing_url", odExistURL) },
		func(t *testing.T, e *odEnv) { e.marker(t, "auth_fail", "1") },
	} {
		e := odSetup(t, odOpts{})
		setup(t, e)
		_, _ = e.run(t)
		for _, c := range e.ghCalls(t) {
			if len(c) >= 2 && c[0] == "pr" && (c[1] == "ready" || c[1] == "merge") {
				t.Errorf("forbidden gh call: %v", c)
			}
			for _, a := range c {
				if a == "--ready" || a == "--auto" || a == "--merge" || a == "--squash" {
					t.Errorf("forbidden gh arg %q in %v", a, c)
				}
			}
		}
	}
}

func TestOpenDraftHasNoFlagThatReadiesOrMerges(t *testing.T) {
	var found bool
	for _, c := range missionsPrCmd.Commands() {
		if c.Name() != "openDraft" {
			continue
		}
		found = true
		c.Flags().VisitAll(func(f *pflag.Flag) {
			n := strings.ToLower(f.Name)
			for _, bad := range []string{"ready", "merge", "undraft", "auto", "squash"} {
				if strings.Contains(n, bad) {
					t.Errorf("openDraft must have no %q-like flag, found --%s", bad, f.Name)
				}
			}
		})
	}
	if !found {
		t.Fatal("missions-pr has no openDraft subcommand")
	}
}

// ---- untrusted text ----

func TestOpenDraftHostileTitleIsPassedAsOneLiteralArgument(t *testing.T) {
	titles := []string{
		"$(touch PWNED) `touch PWNED` ; touch PWNED",
		"it's \"quoted\" && echo hi > PWNED",
		"--web",
		"-R evil/repo --fill",
		"title with trailing backslash \\",
	}
	for _, title := range titles {
		e := odSetup(t, odOpts{})
		writePRFile(t, odDescPath(e), title+"\n\nBody.\n\nMission: "+e.mission+"\nPRD: item-commits\n")
		e.runOK(t)
		creates := e.createCalls(t)
		if len(creates) != 1 {
			t.Fatalf("title %q: want one create, got %v", title, creates)
		}
		if got, _ := argAfter(creates[0], "--title"); got != title {
			t.Errorf("title %q arrived as %q", title, got)
		}
		if body, _ := argAfter(creates[0], "--body-file"); body != odDescPath(e) {
			t.Errorf("body must go via --body-file, got %q", body)
		}
		for _, a := range creates[0] {
			if a == "--body" || a == "-b" {
				t.Errorf("body text must never be passed inline: %v", creates[0])
			}
		}
		for _, p := range []string{filepath.Join(e.root, "PWNED"), "PWNED"} {
			if _, err := os.Stat(p); err == nil {
				t.Errorf("title %q executed shell code (found %s)", title, p)
			}
		}
	}
}

// The printed fallback command is meant to be pasted into a shell. Running it
// through sh must hand gh the exact title and body path, and execute nothing.
func TestOpenDraftPrintedCommandIsShellSafeForHostileTitle(t *testing.T) {
	title := "$(touch PWNED) `touch PWNED` it's \"q\" ; touch PWNED"
	e := odSetup(t, odOpts{})
	e.writeConfig(t, `{"pullRequest":{"open":false}}`)
	writePRFile(t, odDescPath(e), title+"\n\nBody.\n\nMission: "+e.mission+"\nPRD: item-commits\n")
	out := e.runOK(t)
	line := manualCommandLine(t, out)

	c := exec.Command("sh", "-c", line)
	c.Dir = e.root
	if outb, err := c.CombinedOutput(); err != nil {
		t.Fatalf("printed command failed under sh: %v\n%s\ncommand: %s", err, outb, line)
	}
	creates := e.createCalls(t)
	if len(creates) != 1 {
		t.Fatalf("printed command should invoke gh pr create once, calls=%v", e.ghCalls(t))
	}
	if got, _ := argAfter(creates[0], "--title"); got != title {
		t.Errorf("shell handed gh title %q, want %q (command: %s)", got, title, line)
	}
	if body, _ := argAfter(creates[0], "--body-file"); body != odDescPath(e) {
		t.Errorf("shell handed gh body-file %q, want %q", body, odDescPath(e))
	}
	hasDraft := false
	for _, a := range creates[0] {
		hasDraft = hasDraft || a == "--draft"
	}
	if !hasDraft {
		t.Errorf("printed command must include --draft: %s", line)
	}
	if _, err := os.Stat(filepath.Join(e.root, "PWNED")); err == nil {
		t.Errorf("printed command executed the title as shell code")
	}
}

func TestOpenDraftPrintedCommandForPathWithSpacesIsShellSafe(t *testing.T) {
	e := odSetup(t, odOpts{})
	e.writeConfig(t, `{"pullRequest":{"open":false}}`)
	out := e.runOK(t)
	line := manualCommandLine(t, out)
	c := exec.Command("sh", "-c", line)
	c.Dir = e.root
	if outb, err := c.CombinedOutput(); err != nil {
		t.Fatalf("printed command failed: %v\n%s", err, outb)
	}
	creates := e.createCalls(t)
	if len(creates) != 1 {
		t.Fatalf("calls=%v", e.ghCalls(t))
	}
	if head, _ := argAfter(creates[0], "--head"); head != odBranch {
		t.Errorf("printed command must target the recorded branch: --head=%q", head)
	}
}

// ---- preconditions ----

func TestOpenDraftMissingDescriptionFileErrorsPointingAtDescribe(t *testing.T) {
	e := odSetup(t, odOpts{})
	if err := os.Remove(odDescPath(e)); err != nil {
		t.Fatal(err)
	}
	out, err := e.run(t)
	if err == nil {
		t.Fatalf("missing pr-description.md must be an error:\n%s", out)
	}
	if !strings.Contains(out+err.Error(), "describe") {
		t.Errorf("error should tell the user to run 'missions-pr describe':\n%s\n%v", out, err)
	}
	if len(e.createCalls(t)) != 0 || e.remoteRef(t, odBranch) != "" {
		t.Errorf("nothing may be pushed or opened without a description")
	}
}

func TestOpenDraftMissingRecordedBranchFileErrorsWithoutPushing(t *testing.T) {
	e := odSetup(t, odOpts{})
	if err := os.Remove(filepath.Join(e.poolDir, "branch")); err != nil {
		t.Fatal(err)
	}
	if out, err := e.run(t); err == nil {
		t.Fatalf("missing recorded branch must be an error (never guess HEAD):\n%s", out)
	}
	if len(e.createCalls(t)) != 0 || e.remoteRef(t, odBranch) != "" {
		t.Errorf("nothing may be pushed or opened without a recorded branch")
	}
}
