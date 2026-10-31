package itemcommit

import (
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// git runs a git command in dir and fails the test on error.
func git(t *testing.T, dir string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", append([]string{"-C", dir}, args...)...)
	cmd.Env = append(os.Environ(),
		"GIT_AUTHOR_NAME=t", "GIT_AUTHOR_EMAIL=t@example.com",
		"GIT_COMMITTER_NAME=t", "GIT_COMMITTER_EMAIL=t@example.com",
		"GIT_CONFIG_GLOBAL=/dev/null", "GIT_CONFIG_SYSTEM=/dev/null",
	)
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, out)
	}
	return strings.TrimSpace(string(out))
}

func write(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

// newRepo creates a repo on branch `branch` with one commit and returns its
// symlink-resolved root.
func newRepo(t *testing.T, branch string) string {
	t.Helper()
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	git(t, root, "init", "-b", "main")
	write(t, filepath.Join(root, "tracked.txt"), "v1\n")
	write(t, filepath.Join(root, "gone.txt"), "bye\n")
	git(t, root, "add", ".")
	git(t, root, "commit", "-m", "init")
	if branch != "main" {
		git(t, root, "checkout", "-b", branch)
	}
	return root
}

func readFile(t *testing.T, path string) string {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	return string(b)
}

func TestRepoRootFromSubdirectory(t *testing.T) {
	root := newRepo(t, "main")
	sub := filepath.Join(root, "a", "b")
	if err := os.MkdirAll(sub, 0o755); err != nil {
		t.Fatal(err)
	}
	got, err := RepoRoot(sub)
	if err != nil {
		t.Fatalf("RepoRoot: %v", err)
	}
	if got != root {
		t.Fatalf("RepoRoot = %q, want %q", got, root)
	}
}

func TestRepoRootOutsideRepoErrors(t *testing.T) {
	dir := t.TempDir()
	if _, err := RepoRoot(dir); err == nil {
		t.Fatal("expected error outside a git repo")
	}
}

func TestCurrentBranchReturnsName(t *testing.T) {
	root := newRepo(t, "feat/x")
	got, err := CurrentBranch(root)
	if err != nil {
		t.Fatalf("CurrentBranch: %v", err)
	}
	if got != "feat/x" {
		t.Fatalf("CurrentBranch = %q, want feat/x", got)
	}
}

func TestCurrentBranchDetachedHeadErrors(t *testing.T) {
	root := newRepo(t, "main")
	git(t, root, "checkout", "--detach")
	got, err := CurrentBranch(root)
	if err == nil {
		t.Fatalf("expected error on detached HEAD, got branch %q", got)
	}
	if !strings.Contains(strings.ToLower(err.Error()), "detached") {
		t.Fatalf("error should mention detached HEAD, got: %v", err)
	}
}

func TestRecordBranchWritesBranchFile(t *testing.T) {
	root := newRepo(t, "feat/x")
	pool := t.TempDir()
	if err := RecordBranch(pool, root); err != nil {
		t.Fatalf("RecordBranch: %v", err)
	}
	if got := strings.TrimSpace(readFile(t, filepath.Join(pool, "branch"))); got != "feat/x" {
		t.Fatalf("branch file = %q, want feat/x", got)
	}
}

func TestRecordBranchFromSubdirectory(t *testing.T) {
	root := newRepo(t, "feat/x")
	sub := filepath.Join(root, "deep")
	if err := os.MkdirAll(sub, 0o755); err != nil {
		t.Fatal(err)
	}
	pool := t.TempDir()
	if err := RecordBranch(pool, sub); err != nil {
		t.Fatalf("RecordBranch from subdir: %v", err)
	}
	if got := strings.TrimSpace(readFile(t, filepath.Join(pool, "branch"))); got != "feat/x" {
		t.Fatalf("branch file = %q, want feat/x", got)
	}
}

func TestRecordBranchLeavesExistingFileUnchanged(t *testing.T) {
	root := newRepo(t, "feat/other")
	pool := t.TempDir()
	write(t, filepath.Join(pool, "branch"), "feat/x\n")
	if err := RecordBranch(pool, root); err != nil {
		t.Fatalf("RecordBranch: %v", err)
	}
	if got := strings.TrimSpace(readFile(t, filepath.Join(pool, "branch"))); got != "feat/x" {
		t.Fatalf("existing branch file overwritten: %q", got)
	}
}

func TestRecordBranchDetachedHeadFailsWithoutWriting(t *testing.T) {
	root := newRepo(t, "main")
	git(t, root, "checkout", "--detach")
	pool := t.TempDir()
	if err := RecordBranch(pool, root); err == nil {
		t.Fatal("expected error on detached HEAD")
	}
	if _, err := os.Stat(filepath.Join(pool, "branch")); !os.IsNotExist(err) {
		t.Fatalf("branch file must not be written on detached HEAD (stat err=%v)", err)
	}
}

func TestRecordBranchOutsideRepoErrors(t *testing.T) {
	if err := RecordBranch(t.TempDir(), t.TempDir()); err == nil {
		t.Fatal("expected error outside a git repo")
	}
}

func TestCheckBranchSucceedsWhenEqual(t *testing.T) {
	root := newRepo(t, "feat/x")
	pool := t.TempDir()
	write(t, filepath.Join(pool, "branch"), "feat/x\n")
	if err := CheckBranch(pool, root); err != nil {
		t.Fatalf("CheckBranch: %v", err)
	}
}

func TestCheckBranchSucceedsFromSubdirectory(t *testing.T) {
	root := newRepo(t, "feat/x")
	sub := filepath.Join(root, "pkg", "inner")
	if err := os.MkdirAll(sub, 0o755); err != nil {
		t.Fatal(err)
	}
	pool := t.TempDir()
	write(t, filepath.Join(pool, "branch"), "feat/x\n")
	if err := CheckBranch(pool, sub); err != nil {
		t.Fatalf("CheckBranch from subdir: %v", err)
	}
}

func TestCheckBranchToleratesNoTrailingNewline(t *testing.T) {
	root := newRepo(t, "feat/x")
	pool := t.TempDir()
	write(t, filepath.Join(pool, "branch"), "feat/x")
	if err := CheckBranch(pool, root); err != nil {
		t.Fatalf("hand-written branch file without newline should pass: %v", err)
	}
}

func TestCheckBranchMismatchNamesBothBranches(t *testing.T) {
	root := newRepo(t, "main")
	pool := t.TempDir()
	write(t, filepath.Join(pool, "branch"), "feat/x\n")
	err := CheckBranch(pool, root)
	if err == nil {
		t.Fatal("expected mismatch error")
	}
	if !strings.Contains(err.Error(), "feat/x") || !strings.Contains(err.Error(), "main") {
		t.Fatalf("error must name recorded feat/x and current main, got: %v", err)
	}
}

func TestCheckBranchMismatchIsNotPrefixMatch(t *testing.T) {
	root := newRepo(t, "feat/x-2")
	pool := t.TempDir()
	write(t, filepath.Join(pool, "branch"), "feat/x\n")
	if err := CheckBranch(pool, root); err == nil {
		t.Fatal("feat/x-2 must not match recorded feat/x")
	}
}

func TestCheckBranchMissingFileTellsOperatorHowToRecover(t *testing.T) {
	root := newRepo(t, "feat/x")
	err := CheckBranch(t.TempDir(), root)
	if err == nil {
		t.Fatal("expected error when branch file is missing")
	}
	if !strings.Contains(err.Error(), "ateam pool init") {
		t.Fatalf("error must tell operator to re-run 'ateam pool init', got: %v", err)
	}
	if !strings.Contains(strings.ToLower(err.Error()), "by hand") {
		t.Fatalf("error must mention writing the branch name by hand, got: %v", err)
	}
}

func TestCheckBranchEmptyFileIsAnError(t *testing.T) {
	root := newRepo(t, "feat/x")
	pool := t.TempDir()
	write(t, filepath.Join(pool, "branch"), "\n")
	if err := CheckBranch(pool, root); err == nil {
		t.Fatal("an empty branch file must not pass the check")
	}
}

func TestCheckBranchDetachedHeadFailsEvenIfRecordedBranchExists(t *testing.T) {
	root := newRepo(t, "main")
	git(t, root, "checkout", "--detach")
	pool := t.TempDir()
	write(t, filepath.Join(pool, "branch"), "main\n")
	if err := CheckBranch(pool, root); err == nil {
		t.Fatal("detached HEAD must fail the branch check")
	}
}

func TestCheckBranchOutsideRepoErrors(t *testing.T) {
	pool := t.TempDir()
	write(t, filepath.Join(pool, "branch"), "main\n")
	if err := CheckBranch(pool, t.TempDir()); err == nil {
		t.Fatal("expected error outside a git repo")
	}
}

// --- baseline-dirty ---

func parseBaseline(t *testing.T, content string) map[string]string {
	t.Helper()
	m := map[string]string{}
	for _, line := range strings.Split(strings.TrimRight(content, "\n"), "\n") {
		if line == "" {
			continue
		}
		parts := strings.SplitN(line, "\t", 2)
		if len(parts) != 2 {
			t.Fatalf("baseline line %q is not '<hash>\\t<path>'", line)
		}
		m[parts[1]] = parts[0]
	}
	return m
}

func TestRecordBaselineDirtyListsEachDirtyPathWithHash(t *testing.T) {
	root := newRepo(t, "feat/x")
	write(t, filepath.Join(root, "tracked.txt"), "v2 modified\n")
	write(t, filepath.Join(root, "new.txt"), "untracked\n")
	if err := os.Remove(filepath.Join(root, "gone.txt")); err != nil {
		t.Fatal(err)
	}
	pool := t.TempDir()
	if err := RecordBaselineDirty(pool, root); err != nil {
		t.Fatalf("RecordBaselineDirty: %v", err)
	}
	got := parseBaseline(t, readFile(t, filepath.Join(pool, "baseline-dirty")))

	if len(got) != 3 {
		t.Fatalf("expected exactly 3 entries, got %v", got)
	}
	for _, p := range []string{"tracked.txt", "new.txt"} {
		want := git(t, root, "hash-object", p)
		if got[p] != want {
			t.Errorf("%s hash = %q, want %q", p, got[p], want)
		}
	}
	if got["gone.txt"] != "-" {
		t.Errorf("deleted file hash = %q, want '-'", got["gone.txt"])
	}
}

func TestRecordBaselineDirtyListsFilesInsideUntrackedDirectoriesIndividually(t *testing.T) {
	root := newRepo(t, "feat/x")
	write(t, filepath.Join(root, "newdir", "a.txt"), "a\n")
	write(t, filepath.Join(root, "newdir", "nested", "b.txt"), "b\n")
	pool := t.TempDir()
	if err := RecordBaselineDirty(pool, root); err != nil {
		t.Fatalf("RecordBaselineDirty: %v", err)
	}
	got := parseBaseline(t, readFile(t, filepath.Join(pool, "baseline-dirty")))
	for _, p := range []string{"newdir/a.txt", "newdir/nested/b.txt"} {
		if _, ok := got[p]; !ok {
			t.Errorf("expected %s listed individually, got %v", p, got)
		}
	}
	if _, ok := got["newdir/"]; ok {
		t.Errorf("directory entry 'newdir/' must not be listed: %v", got)
	}
}

func TestRecordBaselineDirtyHandlesAwkwardFilenames(t *testing.T) {
	root := newRepo(t, "feat/x")
	names := []string{"with space.txt", "quote\"d.txt", "ünï.txt"}
	for _, n := range names {
		write(t, filepath.Join(root, n), "x\n")
	}
	pool := t.TempDir()
	if err := RecordBaselineDirty(pool, root); err != nil {
		t.Fatalf("RecordBaselineDirty: %v", err)
	}
	got := parseBaseline(t, readFile(t, filepath.Join(pool, "baseline-dirty")))
	for _, n := range names {
		if got[n] != git(t, root, "hash-object", "--", n) {
			t.Errorf("%q missing or wrong hash in %v", n, got)
		}
	}
}

func TestRecordBaselineDirtyIncludesStagedNewFile(t *testing.T) {
	root := newRepo(t, "feat/x")
	write(t, filepath.Join(root, "staged.txt"), "s\n")
	git(t, root, "add", "staged.txt")
	pool := t.TempDir()
	if err := RecordBaselineDirty(pool, root); err != nil {
		t.Fatal(err)
	}
	got := parseBaseline(t, readFile(t, filepath.Join(pool, "baseline-dirty")))
	if got["staged.txt"] != git(t, root, "hash-object", "staged.txt") {
		t.Fatalf("staged file missing or wrong hash: %v", got)
	}
}

func TestRecordBaselineDirtyPathsAreRepoRelativeFromSubdirectory(t *testing.T) {
	root := newRepo(t, "feat/x")
	write(t, filepath.Join(root, "top.txt"), "t\n")
	write(t, filepath.Join(root, "sub", "inner.txt"), "i\n")
	pool := t.TempDir()
	if err := RecordBaselineDirty(pool, filepath.Join(root, "sub")); err != nil {
		t.Fatalf("RecordBaselineDirty: %v", err)
	}
	got := parseBaseline(t, readFile(t, filepath.Join(pool, "baseline-dirty")))
	if _, ok := got["top.txt"]; !ok {
		t.Errorf("file outside the subdir must still be listed: %v", got)
	}
	if _, ok := got["sub/inner.txt"]; !ok {
		t.Errorf("expected repo-relative 'sub/inner.txt': %v", got)
	}
	if _, ok := got["inner.txt"]; ok {
		t.Errorf("cwd-relative path leaked into baseline: %v", got)
	}
}

func TestRecordBaselineDirtyCleanTreeWritesEmptyFile(t *testing.T) {
	root := newRepo(t, "feat/x")
	pool := t.TempDir()
	if err := RecordBaselineDirty(pool, root); err != nil {
		t.Fatalf("RecordBaselineDirty: %v", err)
	}
	b, err := os.ReadFile(filepath.Join(pool, "baseline-dirty"))
	if err != nil {
		t.Fatalf("baseline-dirty must exist even when tree is clean: %v", err)
	}
	if strings.TrimSpace(string(b)) != "" {
		t.Fatalf("expected empty baseline, got %q", b)
	}
}

func TestRecordBaselineDirtyKeepsExistingFile(t *testing.T) {
	root := newRepo(t, "feat/x")
	pool := t.TempDir()
	write(t, filepath.Join(root, "before.txt"), "b\n")
	if err := RecordBaselineDirty(pool, root); err != nil {
		t.Fatal(err)
	}
	original := readFile(t, filepath.Join(pool, "baseline-dirty"))

	// Mission work lands, then pool init re-runs (resume recovery).
	write(t, filepath.Join(root, "mission-work.txt"), "m\n")
	if err := RecordBaselineDirty(pool, root); err != nil {
		t.Fatalf("second RecordBaselineDirty: %v", err)
	}
	if after := readFile(t, filepath.Join(pool, "baseline-dirty")); after != original {
		t.Fatalf("baseline-dirty was rewritten:\nbefore=%q\nafter=%q", original, after)
	}
}

func TestRecordBaselineDirtyOutsideRepoErrors(t *testing.T) {
	pool := t.TempDir()
	if err := RecordBaselineDirty(pool, t.TempDir()); err == nil {
		t.Fatal("expected error outside a git repo")
	}
	if _, err := os.Stat(filepath.Join(pool, "baseline-dirty")); !os.IsNotExist(err) {
		t.Fatalf("no baseline file may be written on failure (stat err=%v)", err)
	}
}

func TestReadBaselineDirtyRoundTrip(t *testing.T) {
	root := newRepo(t, "feat/x")
	write(t, filepath.Join(root, "tracked.txt"), "changed\n")
	write(t, filepath.Join(root, "dir", "u.txt"), "u\n")
	_ = os.Remove(filepath.Join(root, "gone.txt"))
	pool := t.TempDir()
	if err := RecordBaselineDirty(pool, root); err != nil {
		t.Fatal(err)
	}
	got, err := ReadBaselineDirty(pool)
	if err != nil {
		t.Fatalf("ReadBaselineDirty: %v", err)
	}
	want := map[string]string{
		"tracked.txt": git(t, root, "hash-object", "tracked.txt"),
		"dir/u.txt":   git(t, root, "hash-object", "dir/u.txt"),
		"gone.txt":    "-",
	}
	if len(got) != len(want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	for p, h := range want {
		if got[p] != h {
			t.Errorf("%s = %q, want %q", p, got[p], h)
		}
	}
}

func TestReadBaselineDirtyMissingFileIsNotExistError(t *testing.T) {
	_, err := ReadBaselineDirty(t.TempDir())
	if err == nil {
		t.Fatal("expected error for missing baseline-dirty")
	}
	if !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("error should wrap os.ErrNotExist so callers can distinguish it, got: %v", err)
	}
}

func TestReadBaselineDirtyEmptyFileIsEmptyMap(t *testing.T) {
	pool := t.TempDir()
	write(t, filepath.Join(pool, "baseline-dirty"), "")
	got, err := ReadBaselineDirty(pool)
	if err != nil {
		t.Fatalf("ReadBaselineDirty: %v", err)
	}
	if len(got) != 0 {
		t.Fatalf("expected empty map, got %v", got)
	}
}

func TestReadBaselineDirtyKeepsPathsContainingTabs(t *testing.T) {
	pool := t.TempDir()
	write(t, filepath.Join(pool, "baseline-dirty"), "abc123\ta\tb.txt\n")
	got, err := ReadBaselineDirty(pool)
	if err != nil {
		t.Fatal(err)
	}
	if got["a\tb.txt"] != "abc123" {
		t.Fatalf("only the first tab separates hash from path, got %v", got)
	}
}

// --- symlinks, newline names, nested repos (Amy rejection) ---

// blobOfString returns the git blob id of s, which is how git stores a symlink.
func blobOfString(t *testing.T, root, s string) string {
	t.Helper()
	cmd := exec.Command("git", "-C", root, "hash-object", "--stdin")
	cmd.Stdin = strings.NewReader(s)
	out, err := cmd.Output()
	if err != nil {
		t.Fatalf("hash-object --stdin: %v", err)
	}
	return strings.TrimSpace(string(out))
}

func TestRecordBaselineDirtyDanglingSymlinkDoesNotAbort(t *testing.T) {
	root := newRepo(t, "feat/x")
	if err := os.Symlink("does-not-exist", filepath.Join(root, "dangling")); err != nil {
		t.Fatal(err)
	}
	pool := t.TempDir()
	if err := RecordBaselineDirty(pool, root); err != nil {
		t.Fatalf("dangling symlink must not abort RecordBaselineDirty: %v", err)
	}
	got, err := ReadBaselineDirty(pool)
	if err != nil {
		t.Fatal(err)
	}
	if got["dangling"] != blobOfString(t, root, "does-not-exist") {
		t.Fatalf("dangling symlink should hash as its link text, got %q", got["dangling"])
	}
}

func TestRecordBaselineDirtySymlinkToDirectoryDoesNotAbort(t *testing.T) {
	root := newRepo(t, "feat/x")
	if err := os.MkdirAll(filepath.Join(root, "realdir"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink("realdir", filepath.Join(root, "dirlink")); err != nil {
		t.Fatal(err)
	}
	pool := t.TempDir()
	if err := RecordBaselineDirty(pool, root); err != nil {
		t.Fatalf("symlink to a directory must not abort: %v", err)
	}
	got, _ := ReadBaselineDirty(pool)
	if got["dirlink"] != blobOfString(t, root, "realdir") {
		t.Fatalf("dir symlink should hash as its link text, got %q", got["dirlink"])
	}
}

func TestRecordBaselineDirtySymlinkToDeletedTrackedFileDoesNotAbort(t *testing.T) {
	root := newRepo(t, "feat/x")
	if err := os.Symlink("gone.txt", filepath.Join(root, "tolink")); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(filepath.Join(root, "gone.txt")); err != nil {
		t.Fatal(err)
	}
	pool := t.TempDir()
	if err := RecordBaselineDirty(pool, root); err != nil {
		t.Fatalf("symlink to a deleted file must not abort: %v", err)
	}
	got, _ := ReadBaselineDirty(pool)
	if got["tolink"] != blobOfString(t, root, "gone.txt") {
		t.Fatalf("symlink should hash as its link text, got %q", got["tolink"])
	}
	if got["gone.txt"] != "-" {
		t.Fatalf("the deleted file itself must still be '-', got %q", got["gone.txt"])
	}
}

func TestRecordBaselineDirtySymlinkToFileHashesLinkNotTarget(t *testing.T) {
	root := newRepo(t, "feat/x")
	if err := os.Symlink("tracked.txt", filepath.Join(root, "filelink")); err != nil {
		t.Fatal(err)
	}
	pool := t.TempDir()
	if err := RecordBaselineDirty(pool, root); err != nil {
		t.Fatal(err)
	}
	got, _ := ReadBaselineDirty(pool)
	if got["filelink"] != blobOfString(t, root, "tracked.txt") {
		t.Fatalf("symlink must hash its link text, not the target's content: %q", got["filelink"])
	}
}

func TestBaselineDirtyRoundTripsPathWithNewline(t *testing.T) {
	root := newRepo(t, "feat/x")
	name := "line1\nline2.txt"
	write(t, filepath.Join(root, name), "x\n")
	write(t, filepath.Join(root, "plain.txt"), "p\n")
	pool := t.TempDir()
	if err := RecordBaselineDirty(pool, root); err != nil {
		t.Fatalf("RecordBaselineDirty: %v", err)
	}
	got, err := ReadBaselineDirty(pool)
	if err != nil {
		t.Fatalf("ReadBaselineDirty must not fail on a newline in a path: %v", err)
	}
	if got[name] != git(t, root, "hash-object", "--", name) {
		t.Fatalf("newline path missing or wrong hash; got %q", got)
	}
	if _, ok := got["plain.txt"]; !ok {
		t.Fatalf("other entries must survive: %v", got)
	}
}

func TestRecordBaselineDirtyNestedRepoIsNotMarkedDeleted(t *testing.T) {
	root := newRepo(t, "feat/x")
	nested := filepath.Join(root, "nested")
	if err := os.MkdirAll(nested, 0o755); err != nil {
		t.Fatal(err)
	}
	git(t, nested, "init", "-b", "main")
	write(t, filepath.Join(nested, "f.txt"), "f\n")
	git(t, nested, "add", ".")
	git(t, nested, "commit", "-m", "n")
	write(t, filepath.Join(nested, "f.txt"), "dirty\n")
	pool := t.TempDir()
	if err := RecordBaselineDirty(pool, root); err != nil {
		t.Fatalf("nested repo must not abort: %v", err)
	}
	got, err := ReadBaselineDirty(pool)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) == 0 {
		t.Fatal("nested repo content must be recorded as pre-existing in some form")
	}
	for p, h := range got {
		if strings.HasPrefix(p, "nested") && h == "-" {
			t.Fatalf("existing nested repo path %q recorded as deleted ('-')", p)
		}
	}
}
