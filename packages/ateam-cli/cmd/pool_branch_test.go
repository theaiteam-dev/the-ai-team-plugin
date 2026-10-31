package cmd

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// poolGit runs git in dir with a hermetic identity/config.
func poolGit(t *testing.T, dir string, args ...string) {
	t.Helper()
	c := exec.Command("git", append([]string{"-C", dir}, args...)...)
	c.Env = append(os.Environ(),
		"GIT_AUTHOR_NAME=t", "GIT_AUTHOR_EMAIL=t@example.com",
		"GIT_COMMITTER_NAME=t", "GIT_COMMITTER_EMAIL=t@example.com",
		"GIT_CONFIG_GLOBAL=/dev/null", "GIT_CONFIG_SYSTEM=/dev/null",
	)
	if out, err := c.CombinedOutput(); err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, out)
	}
}

// chdirToRepo creates a repo on `branch`, with an uncommitted file, and makes
// it the process working directory for the test (pool init reads cwd).
func chdirToRepo(t *testing.T, branch string) string {
	t.Helper()
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	poolGit(t, root, "init", "-b", "main")
	if err := os.WriteFile(filepath.Join(root, "a.txt"), []byte("a\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	poolGit(t, root, "add", ".")
	poolGit(t, root, "commit", "-m", "init")
	if branch != "main" {
		poolGit(t, root, "checkout", "-b", branch)
	}
	old, _ := os.Getwd()
	if err := os.Chdir(root); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chdir(old) })
	return root
}

func TestPoolInitWritesBranchFile(t *testing.T) {
	_, poolDir := withTempPoolRoot(t, "branch-write")
	chdirToRepo(t, "feat/x")
	if out, err := runPoolCmd(t, "pool", "init"); err != nil {
		t.Fatalf("pool init: %v\n%s", err, out)
	}
	b, err := os.ReadFile(filepath.Join(poolDir, "branch"))
	if err != nil {
		t.Fatalf("branch file: %v", err)
	}
	if strings.TrimSpace(string(b)) != "feat/x" {
		t.Fatalf("branch = %q, want feat/x", b)
	}
}

func TestPoolInitWritesBaselineDirtyFromSubdirectory(t *testing.T) {
	_, poolDir := withTempPoolRoot(t, "baseline-write")
	root := chdirToRepo(t, "feat/x")
	if err := os.MkdirAll(filepath.Join(root, "sub"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "sub", "wip.txt"), []byte("w\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Chdir(filepath.Join(root, "sub")); err != nil {
		t.Fatal(err)
	}
	if out, err := runPoolCmd(t, "pool", "init"); err != nil {
		t.Fatalf("pool init: %v\n%s", err, out)
	}
	b, err := os.ReadFile(filepath.Join(poolDir, "baseline-dirty"))
	if err != nil {
		t.Fatalf("baseline-dirty: %v", err)
	}
	if !strings.Contains(string(b), "\tsub/wip.txt\n") {
		t.Fatalf("baseline should list repo-relative sub/wip.txt, got %q", b)
	}
	if branch, _ := os.ReadFile(filepath.Join(poolDir, "branch")); strings.TrimSpace(string(branch)) != "feat/x" {
		t.Fatalf("branch recorded from subdir = %q", branch)
	}
}

func TestPoolInitRerunLeavesBranchAndBaselineUnchanged(t *testing.T) {
	_, poolDir := withTempPoolRoot(t, "rerun")
	root := chdirToRepo(t, "feat/x")
	if err := os.WriteFile(filepath.Join(root, "pre.txt"), []byte("p\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if out, err := runPoolCmd(t, "pool", "init"); err != nil {
		t.Fatalf("first init: %v\n%s", err, out)
	}
	baseBefore, _ := os.ReadFile(filepath.Join(poolDir, "baseline-dirty"))

	// Mission work appears and the branch changes; re-init must not absorb either.
	if err := os.WriteFile(filepath.Join(root, "mission.txt"), []byte("m\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	poolGit(t, root, "checkout", "-b", "feat/other")
	if out, err := runPoolCmd(t, "pool", "init"); err != nil {
		t.Fatalf("second init: %v\n%s", err, out)
	}
	baseAfter, _ := os.ReadFile(filepath.Join(poolDir, "baseline-dirty"))
	if string(baseAfter) != string(baseBefore) {
		t.Fatalf("baseline-dirty rewritten:\n%q\n%q", baseBefore, baseAfter)
	}
	if strings.Contains(string(baseAfter), "mission.txt") {
		t.Fatal("mission work recorded as pre-existing")
	}
	if b, _ := os.ReadFile(filepath.Join(poolDir, "branch")); strings.TrimSpace(string(b)) != "feat/x" {
		t.Fatalf("branch overwritten: %q", b)
	}
}

func TestPoolInitDetachedHeadFailsWithClearMessage(t *testing.T) {
	_, poolDir := withTempPoolRoot(t, "detached")
	root := chdirToRepo(t, "main")
	poolGit(t, root, "checkout", "--detach")
	out, err := runPoolCmd(t, "pool", "init")
	if err == nil {
		t.Fatalf("expected pool init to fail on detached HEAD, output: %s", out)
	}
	if !strings.Contains(strings.ToLower(err.Error()), "detached") {
		t.Fatalf("error should mention detached HEAD: %v", err)
	}
	if b, rerr := os.ReadFile(filepath.Join(poolDir, "branch")); rerr == nil {
		t.Fatalf("must not record a branch on detached HEAD, got %q", b)
	}
}

func TestPoolDestroyKeepsBranchAndBaselineButRemovesMarkers(t *testing.T) {
	_, poolDir := withTempPoolRoot(t, "destroy-keep")
	chdirToRepo(t, "feat/x")
	if out, err := runPoolCmd(t, "pool", "init", "--single-use"); err != nil {
		t.Fatalf("init: %v\n%s", err, out)
	}
	if out, err := runPoolCmd(t, "pool", "destroy"); err != nil {
		t.Fatalf("destroy: %v\n%s", err, out)
	}
	for _, keep := range []string{"branch", "baseline-dirty"} {
		if _, err := os.Stat(filepath.Join(poolDir, keep)); err != nil {
			t.Errorf("%s must survive 'pool destroy': %v", keep, err)
		}
	}
	entries, err := os.ReadDir(poolDir)
	if err != nil {
		t.Fatalf("pool dir should remain: %v", err)
	}
	for _, e := range entries {
		if e.Name() != "branch" && e.Name() != "baseline-dirty" {
			t.Errorf("pool marker %q survived 'pool destroy'", e.Name())
		}
	}
}

func TestPoolDestroyThenInitPreservesBaseline(t *testing.T) {
	_, poolDir := withTempPoolRoot(t, "destroy-init")
	root := chdirToRepo(t, "feat/x")
	if err := os.WriteFile(filepath.Join(root, "pre.txt"), []byte("p\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := runPoolCmd(t, "pool", "init"); err != nil {
		t.Fatal(err)
	}
	before, _ := os.ReadFile(filepath.Join(poolDir, "baseline-dirty"))
	if err := os.WriteFile(filepath.Join(root, "mission.txt"), []byte("m\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := runPoolCmd(t, "pool", "destroy"); err != nil {
		t.Fatal(err)
	}
	if _, err := runPoolCmd(t, "pool", "init"); err != nil {
		t.Fatal(err)
	}
	after, _ := os.ReadFile(filepath.Join(poolDir, "baseline-dirty"))
	if string(after) != string(before) {
		t.Fatalf("resume recovery changed baseline:\n%q\n%q", before, after)
	}
}

func TestPoolDestroyAllRemovesWholeDirectory(t *testing.T) {
	_, poolDir := withTempPoolRoot(t, "destroy-all")
	chdirToRepo(t, "feat/x")
	if _, err := runPoolCmd(t, "pool", "init"); err != nil {
		t.Fatal(err)
	}
	out, err := runPoolCmd(t, "pool", "destroy", "--all")
	if err != nil {
		t.Fatalf("destroy --all: %v\n%s", err, out)
	}
	if _, statErr := os.Stat(poolDir); !os.IsNotExist(statErr) {
		t.Fatalf("pool dir should be gone, stat err=%v", statErr)
	}
}

func TestPoolDestroyWithoutAllStillSucceedsWhenDirMissing(t *testing.T) {
	_, poolDir := withTempPoolRoot(t, "destroy-missing")
	_ = os.RemoveAll(poolDir)
	if out, err := runPoolCmd(t, "pool", "destroy"); err != nil {
		t.Fatalf("destroy on missing dir should be idempotent: %v\n%s", err, out)
	}
}

// A lost baseline mid-mission: init keeps the pool usable but does not record
// the current dirty files as a new baseline, and says how to restore it.
func TestPoolInitLostBaselineWarnsAndDoesNotRecord(t *testing.T) {
	missionID, poolDir := withTempPoolRoot(t, "lost-baseline")
	root := chdirToRepo(t, "feat/x")
	poolGit(t, root, "commit", "--allow-empty", "-m", "feat: item\n\nItem: WI-1\nMission: "+missionID)
	if err := os.WriteFile(filepath.Join(root, "pending.txt"), []byte("p\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	out, err := runPoolCmd(t, "pool", "init", "--single-use")
	if err != nil {
		t.Fatalf("init must still exit 0 so the pool can resume: %v\n%s", err, out)
	}
	if _, statErr := os.Stat(filepath.Join(poolDir, "baseline-dirty")); !os.IsNotExist(statErr) {
		t.Fatalf("baseline-dirty must not be recorded (stat err=%v)", statErr)
	}
	if _, statErr := os.Stat(filepath.Join(poolDir, singleUseMarker)); statErr != nil {
		t.Errorf("single-use marker should still be written: %v", statErr)
	}
	if b, _ := os.ReadFile(filepath.Join(poolDir, "branch")); strings.TrimSpace(string(b)) != "feat/x" {
		t.Errorf("branch file = %q", b)
	}
	for _, want := range []string{"WARNING", filepath.Join(poolDir, "baseline-dirty"), "<git-hash>"} {
		if !strings.Contains(out, want) {
			t.Errorf("output lacks %q:\n%s", want, out)
		}
	}
}
