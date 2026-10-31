// Package itemcommit holds the git helpers behind per-item commits: the branch
// safety rule and the pre-mission dirty-file baseline.
package itemcommit

import (
	"bytes"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

const (
	branchFileName        = "branch"
	baselineDirtyFileName = "baseline-dirty"
	deletedHash           = "-"
)

// runGit runs git with -C <dir> and returns stdout. Stderr is folded into the
// error so callers see why git refused.
func runGit(dir string, args ...string) ([]byte, error) {
	cmd := exec.Command("git", append([]string{"-C", dir}, args...)...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("git %s: %w: %s", strings.Join(args, " "), err, strings.TrimSpace(stderr.String()))
	}
	return stdout.Bytes(), nil
}

// RepoRoot returns the top-level directory of the git repo containing dir.
func RepoRoot(dir string) (string, error) {
	out, err := runGit(dir, "rev-parse", "--show-toplevel")
	if err != nil {
		return "", fmt.Errorf("not inside a git repository (%s): %w", dir, err)
	}
	root := strings.TrimSpace(string(out))
	if root == "" {
		return "", fmt.Errorf("git reported an empty repo root for %s", dir)
	}
	return root, nil
}

// CurrentBranch returns the checked-out branch name, or an error on detached HEAD.
func CurrentBranch(dir string) (string, error) {
	root, err := RepoRoot(dir)
	if err != nil {
		return "", err
	}
	out, err := runGit(root, "symbolic-ref", "--quiet", "--short", "HEAD")
	if err != nil {
		return "", errors.New("detached HEAD: check out a branch before starting the mission")
	}
	branch := strings.TrimSpace(string(out))
	if branch == "" {
		return "", errors.New("detached HEAD: check out a branch before starting the mission")
	}
	return branch, nil
}

// writeIfAbsent creates path with content, leaving an existing file untouched.
func writeIfAbsent(path string, content []byte) error {
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
	if err != nil {
		if errors.Is(err, os.ErrExist) {
			return nil
		}
		return fmt.Errorf("create %s: %w", path, err)
	}
	if _, err := f.Write(content); err != nil {
		_ = f.Close()
		_ = os.Remove(path)
		return fmt.Errorf("write %s: %w", path, err)
	}
	if err := f.Close(); err != nil {
		_ = os.Remove(path)
		return fmt.Errorf("close %s: %w", path, err)
	}
	return nil
}

func exists(path string) (bool, error) {
	if _, err := os.Stat(path); err == nil {
		return true, nil
	} else if errors.Is(err, os.ErrNotExist) {
		return false, nil
	} else {
		return false, err
	}
}

// RecordBranch writes the current branch to <poolDir>/branch. An existing
// file is left unchanged. Nothing is written when the branch cannot be read.
func RecordBranch(poolDir, dir string) error {
	path := filepath.Join(poolDir, branchFileName)
	if found, err := exists(path); err != nil {
		return fmt.Errorf("stat %s: %w", path, err)
	} else if found {
		return nil
	}
	branch, err := CurrentBranch(dir)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(poolDir, 0o755); err != nil {
		return fmt.Errorf("mkdir %s: %w", poolDir, err)
	}
	return writeIfAbsent(path, []byte(branch+"\n"))
}

// CheckBranch succeeds only when the current branch equals the recorded one.
func CheckBranch(poolDir, dir string) error {
	path := filepath.Join(poolDir, branchFileName)
	raw, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return fmt.Errorf("no recorded mission branch at %s: re-run 'ateam pool init', or write the branch name into that file by hand", path)
		}
		return fmt.Errorf("read %s: %w", path, err)
	}
	recorded := strings.TrimSpace(string(raw))
	if recorded == "" {
		return fmt.Errorf("recorded mission branch file %s is empty: re-run 'ateam pool init', or write the branch name into it by hand", path)
	}
	current, err := CurrentBranch(dir)
	if err != nil {
		return err
	}
	if current != recorded {
		return fmt.Errorf("branch mismatch: mission started on %q but the current branch is %q; check out %q, or update %s by hand", recorded, current, recorded, path)
	}
	return nil
}

// dirtyPaths lists repo-relative paths reported by git status. A rename or
// copy yields both its new and original path, the same set Run builds for an
// item's changed paths, so the baseline and the changed set always agree.
func dirtyPaths(root string) ([]string, error) {
	out, err := runGit(root, "status", "--porcelain=v1", "-z", "--untracked-files=all")
	if err != nil {
		return nil, err
	}
	return ParsePorcelain(out), nil
}

// gitOutputWithStdin runs git in dir feeding stdin and returns trimmed stdout.
func gitOutputWithStdin(dir, stdin string, args ...string) (string, error) {
	cmd := exec.Command("git", append([]string{"-C", dir}, args...)...)
	cmd.Stdin = strings.NewReader(stdin)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("git %s: %w: %s", strings.Join(args, " "), err, strings.TrimSpace(stderr.String()))
	}
	return strings.TrimSpace(stdout.String()), nil
}

// hashText returns the git blob id of text, which is how git stores a symlink.
func hashText(root, text string) (string, error) {
	return gitOutputWithStdin(root, text, "hash-object", "--stdin")
}

// hashDirectory fingerprints a directory git reports as one entry, i.e. a
// nested repository. The fingerprint covers its HEAD and its dirty state, so
// mission edits inside it differ from the baseline.
func hashDirectory(root, rel string) (string, error) {
	full := filepath.Join(root, rel)
	head, err := runGit(full, "rev-parse", "HEAD")
	if err != nil {
		head = nil // not a repo, or no commits yet: fingerprint the state alone
	}
	state, err := runGit(full, "status", "--porcelain=v1", "-z", "--untracked-files=all")
	if err != nil {
		return "", fmt.Errorf("fingerprint directory %s: %w", rel, err)
	}
	return hashText(root, strings.TrimSpace(string(head))+"\n"+string(state))
}

// hashPath returns the git object id of the working-tree entry at the
// repo-relative path, or "-" when it does not exist. Symlinks hash their link
// text (never the target); directories (nested repos) hash their state.
func hashPath(root, path string) (string, error) {
	rel := strings.TrimSuffix(path, "/")
	full := filepath.Join(root, rel)
	info, err := os.Lstat(full)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return deletedHash, nil
		}
		return "", fmt.Errorf("stat %s: %w", path, err)
	}
	switch {
	case info.Mode()&os.ModeSymlink != 0:
		target, err := os.Readlink(full)
		if err != nil {
			return "", fmt.Errorf("readlink %s: %w", path, err)
		}
		return hashText(root, target)
	case info.IsDir():
		return hashDirectory(root, rel)
	}
	out, err := runGit(root, "hash-object", "--", rel)
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(out)), nil
}

// encodeBaselinePath keeps ordinary paths as-is. A path that would break the
// one-entry-per-line format (newline, carriage return) or that starts with a
// quote is stored as a Go-quoted string.
func encodeBaselinePath(path string) string {
	if strings.ContainsAny(path, "\n\r") || strings.HasPrefix(path, `"`) {
		return strconv.Quote(path)
	}
	return path
}

func decodeBaselinePath(field string) string {
	if strings.HasPrefix(field, `"`) {
		if unquoted, err := strconv.Unquote(field); err == nil {
			return unquoted
		}
	}
	return field
}

// RecordBaselineDirty writes one "<hash>\t<path>" line per path that is dirty
// now. An existing file is left unchanged, so a re-run never absorbs mission work.
func RecordBaselineDirty(poolDir, dir string) error {
	path := filepath.Join(poolDir, baselineDirtyFileName)
	if found, err := exists(path); err != nil {
		return fmt.Errorf("stat %s: %w", path, err)
	} else if found {
		return nil
	}
	root, err := RepoRoot(dir)
	if err != nil {
		return err
	}
	paths, err := dirtyPaths(root)
	if err != nil {
		return err
	}
	var b strings.Builder
	for _, p := range paths {
		hash, err := hashPath(root, p)
		if err != nil {
			return err
		}
		b.WriteString(hash + "\t" + encodeBaselinePath(p) + "\n")
	}
	if err := os.MkdirAll(poolDir, 0o755); err != nil {
		return fmt.Errorf("mkdir %s: %w", poolDir, err)
	}
	return writeIfAbsent(path, []byte(b.String()))
}

// BaselineLostError reports that baseline-dirty is missing although the
// mission already has commits on the current branch. The files dirty now
// include mission work, so recording them would exclude that work from item
// commits and from Tawnia's final commit.
type BaselineLostError struct {
	MissionID string
	Path      string
}

func (e *BaselineLostError) Error() string {
	return fmt.Sprintf("baseline-dirty is missing but mission %s already has commits on this branch, so the current dirty files are not the pre-mission set and were not recorded. "+
		"Restore it by hand: write %s with one \"<git-hash>\\t<path>\" line per file that was dirty before the mission started "+
		"(use '-' as the hash for a file that was deleted); an empty file means none were. Item commits refuse to run until it exists",
		e.MissionID, e.Path)
}

// hasMissionCommit reports whether HEAD's history holds a commit with a
// "Mission: <missionID>" trailer. A repo with no commits has none.
func hasMissionCommit(root, missionID string) (bool, error) {
	if _, err := runGit(root, "rev-parse", "--verify", "--quiet", "HEAD"); err != nil {
		return false, nil
	}
	out, err := runGit(root, "log", "-E", "--grep=^Mission: "+regexp.QuoteMeta(missionID)+"$",
		"--format=%(trailers:key=Mission,valueonly,separator=%x1f)%x1e", "HEAD")
	if err != nil {
		return false, err
	}
	for _, record := range strings.Split(string(out), "\x1e") {
		for _, value := range strings.Split(record, "\x1f") {
			if strings.TrimSpace(value) == missionID {
				return true, nil
			}
		}
	}
	return false, nil
}

// RecordBaselineForMission is RecordBaselineDirty with a guard for a lost
// baseline. When the file is missing and the current branch already carries a
// commit for missionID, nothing is written and a *BaselineLostError comes
// back. With no mission id the guard is skipped.
func RecordBaselineForMission(poolDir, dir, missionID string) error {
	path := filepath.Join(poolDir, baselineDirtyFileName)
	if found, err := exists(path); err != nil {
		return fmt.Errorf("stat %s: %w", path, err)
	} else if found {
		return nil
	}
	if missionID != "" {
		root, err := RepoRoot(dir)
		if err != nil {
			return err
		}
		started, err := hasMissionCommit(root, missionID)
		if err != nil {
			return err
		}
		if started {
			return &BaselineLostError{MissionID: missionID, Path: path}
		}
	}
	return RecordBaselineDirty(poolDir, dir)
}

// ReadBaselineDirty returns path -> hash from <poolDir>/baseline-dirty. A
// missing file yields an error wrapping os.ErrNotExist.
func ReadBaselineDirty(poolDir string) (map[string]string, error) {
	path := filepath.Join(poolDir, baselineDirtyFileName)
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", path, err)
	}
	baseline := map[string]string{}
	for _, line := range strings.Split(string(raw), "\n") {
		if line == "" {
			continue
		}
		hash, p, ok := strings.Cut(line, "\t")
		if !ok {
			return nil, fmt.Errorf("malformed line in %s: %q", path, line)
		}
		baseline[decodeBaselinePath(p)] = hash
	}
	return baseline, nil
}
