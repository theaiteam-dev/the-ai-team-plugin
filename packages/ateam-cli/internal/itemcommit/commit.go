package itemcommit

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"ateam/internal/client"
)

const (
	defaultPoolRoot = "/tmp/.ateam-pool"
	lockFileName    = "commit.lock"
	indexLockPoll   = 50 * time.Millisecond
	noChangesNote   = "no changes to commit: no attributed paths for this item"
)

// indexLockWait is how long resetIndexPaths retries a held index.lock. It is a
// variable so tests can shorten it.
var indexLockWait = 10 * time.Second

// Options configures one item commit.
type Options struct {
	Client    *client.Client
	ItemID    string
	Agent     string // recorded on the no-changes work-log note
	Dir       string // working directory; may be a repo subdirectory
	PoolRoot  string // parent of the per-mission pool dir; defaults to /tmp/.ateam-pool
	MissionID string // when empty: $ATEAM_MISSION_ID, then GET /api/missions/current
}

// CommitResult describes what Run did.
type CommitResult struct {
	SHA       string   // new HEAD SHA; empty when nothing was committed
	NoChanges bool     // attributed path set was empty
	Paths     []string // committed paths
	Recorded  bool     // the commitSha PATCH succeeded; false when SHA is set means it did not
}

type apiItem struct {
	ID       string            `json:"id"`
	Title    string            `json:"title"`
	Type     string            `json:"type"`
	Stage    string            `json:"stageId"`
	Outputs  map[string]string `json:"outputs"`
	WorkLogs []struct {
		Agent     string `json:"agent"`
		Action    string `json:"action"`
		Timestamp string `json:"timestamp"`
	} `json:"workLogs"`
}

type apiMission struct {
	ID      string `json:"id"`
	PRDPath string `json:"prdPath"`
}

// Run commits the item's attributed paths onto the current branch and records
// the commit SHA on the item. It never amends, and never touches index entries
// outside the committed paths.
func Run(opts Options) (CommitResult, error) {
	if opts.Client == nil {
		return CommitResult{}, errors.New("itemcommit: client is required")
	}
	if opts.ItemID == "" {
		return CommitResult{}, errors.New("itemcommit: item id is required")
	}
	root, err := RepoRoot(opts.Dir)
	if err != nil {
		return CommitResult{}, err
	}
	mission, err := fetchMission(opts.Client)
	if err != nil {
		return CommitResult{}, err
	}
	missionID := firstNonEmpty(opts.MissionID, os.Getenv("ATEAM_MISSION_ID"), mission.ID)
	if missionID == "" {
		return CommitResult{}, errors.New("cannot resolve mission id: set ATEAM_MISSION_ID or start a mission")
	}
	poolRoot := firstNonEmpty(opts.PoolRoot, defaultPoolRoot)
	poolDir := filepath.Join(poolRoot, missionID)

	if err := CheckBranch(poolDir, root); err != nil {
		return CommitResult{}, err
	}
	self, others, err := fetchItems(opts.Client, opts.ItemID)
	if err != nil {
		return CommitResult{}, err
	}
	baseline, err := ReadBaselineDirty(poolDir)
	if err != nil {
		return CommitResult{}, fmt.Errorf("pre-mission baseline unavailable (refusing to commit without it): %w", err)
	}

	unlock, err := lockDir(poolDir)
	if err != nil {
		return CommitResult{}, err
	}
	defer unlock()

	// Re-check under the lock: another process may have switched branches while we waited.
	if err := CheckBranch(poolDir, root); err != nil {
		return CommitResult{}, err
	}
	statusOut, err := runGit(root, "status", "--porcelain=v1", "-z", "--untracked-files=all")
	if err != nil {
		return CommitResult{}, err
	}
	attribution := Attribute(Input{
		Changed:  ParsePorcelain(statusOut),
		Self:     toAttributionItem(self),
		Others:   toAttributionItems(others),
		Baseline: keys(baseline),
	})
	if len(attribution.Paths) == 0 {
		return recordNoChanges(opts)
	}

	message, err := buildItemMessage(self, missionID, mission.PRDPath, attribution)
	if err != nil {
		return CommitResult{}, err
	}
	sha, err := commitPaths(root, attribution.Paths, message)
	if errors.Is(err, errEmptyTree) {
		return recordNoChanges(opts)
	}
	if err != nil {
		return CommitResult{}, err
	}
	res := CommitResult{SHA: sha, Paths: attribution.Paths}

	resetErr := resetIndexPaths(root, attribution.Paths)
	if _, err := opts.Client.Do("PATCH", "/api/items/{id}", map[string]string{"id": opts.ItemID}, nil, map[string]any{"commitSha": sha}); err != nil {
		return res, fmt.Errorf("committed %s but recording commitSha failed: %w", sha, err)
	}
	res.Recorded = true
	if resetErr != nil {
		return res, fmt.Errorf("committed %s but refreshing the index failed: %w", sha, resetErr)
	}
	return res, nil
}

func recordNoChanges(opts Options) (CommitResult, error) {
	body := map[string]any{"workLogNote": map[string]string{"agent": opts.Agent, "summary": noChangesNote}}
	if _, err := opts.Client.Do("PATCH", "/api/items/{id}", map[string]string{"id": opts.ItemID}, nil, body); err != nil {
		return CommitResult{}, fmt.Errorf("record no-changes note: %w", err)
	}
	return CommitResult{NoChanges: true}, nil
}

func fetchMission(c *client.Client) (apiMission, error) {
	raw, err := c.Do("GET", "/api/missions/current", nil, nil, nil)
	if err != nil {
		return apiMission{}, fmt.Errorf("fetch current mission: %w", err)
	}
	var env struct {
		Data apiMission `json:"data"`
	}
	if err := json.Unmarshal(raw, &env); err != nil {
		return apiMission{}, fmt.Errorf("decode current mission: %w", err)
	}
	return env.Data, nil
}

// fetchItems returns the item with the given id and every other mission item.
func fetchItems(c *client.Client, id string) (apiItem, []apiItem, error) {
	raw, err := c.Do("GET", "/api/items/{id}", map[string]string{"id": id}, nil, nil)
	if err != nil {
		return apiItem{}, nil, fmt.Errorf("fetch item %s: %w", id, err)
	}
	var one struct {
		Data apiItem `json:"data"`
	}
	if err := json.Unmarshal(raw, &one); err != nil {
		return apiItem{}, nil, fmt.Errorf("decode item %s: %w", id, err)
	}
	if one.Data.ID == "" {
		return apiItem{}, nil, fmt.Errorf("item %s not found in API response", id)
	}
	raw, err = c.Do("GET", "/api/items", nil, nil, nil)
	if err != nil {
		return apiItem{}, nil, fmt.Errorf("list items: %w", err)
	}
	var all struct {
		Data []apiItem `json:"data"`
	}
	if err := json.Unmarshal(raw, &all); err != nil {
		return apiItem{}, nil, fmt.Errorf("decode item list: %w", err)
	}
	var others []apiItem
	for _, it := range all.Data {
		if it.ID != id {
			others = append(others, it)
		}
	}
	return one.Data, others, nil
}

func toAttributionItem(it apiItem) Item {
	var outputs []string
	for _, p := range it.Outputs {
		if p != "" {
			outputs = append(outputs, p)
		}
	}
	return Item{ID: it.ID, Stage: it.Stage, Outputs: outputs}
}

// toAttributionItems maps sibling items. A staged sibling may not have been
// committed yet, so its outputs still belong to it: it counts as unfinished.
func toAttributionItems(items []apiItem) []Item {
	out := make([]Item, len(items))
	for i, it := range items {
		out[i] = toAttributionItem(it)
		if out[i].Stage == "staged" {
			out[i].Stage = "uncommitted"
		}
	}
	return out
}

func keys(m map[string]string) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}

// buildItemMessage builds the commit message, refusing line breaks in
// caller-controlled fields (they could forge trailers) and dropping trailers
// that would have an empty value.
func buildItemMessage(it apiItem, missionID, prdPath string, attr Result) (string, error) {
	for name, value := range map[string]string{"title": it.Title, "mission id": missionID} {
		if strings.ContainsAny(value, "\r\n") {
			return "", fmt.Errorf("item %s %s contains a line break; refusing to build a commit message", it.ID, name)
		}
	}
	for _, p := range attr.Undeclared {
		if strings.ContainsAny(p, "\r\n") {
			return "", fmt.Errorf("undeclared path %q contains a line break; refusing to build a commit message", p)
		}
	}
	workLog := make([]WorkLogEntry, len(it.WorkLogs))
	for i, e := range it.WorkLogs {
		workLog[i] = WorkLogEntry{Agent: e.Agent, Action: e.Action, Timestamp: e.Timestamp}
	}
	msg, err := BuildMessage(CommitItem{ID: it.ID, Title: it.Title, Type: it.Type}, workLog, missionID, prdPath, attr.Undeclared)
	if err != nil {
		return "", err
	}
	var lines []string
	for _, line := range strings.Split(msg, "\n") {
		if strings.TrimSpace(line) == "PRD:" || strings.TrimSpace(line) == "Lanes:" {
			continue
		}
		lines = append(lines, line)
	}
	return strings.TrimRight(strings.Join(lines, "\n"), "\n") + "\n", nil
}

// lockDir takes an exclusive advisory lock in poolDir, blocking until free.
func lockDir(poolDir string) (func(), error) {
	if err := os.MkdirAll(poolDir, 0o755); err != nil {
		return nil, fmt.Errorf("mkdir %s: %w", poolDir, err)
	}
	f, err := os.OpenFile(filepath.Join(poolDir, lockFileName), os.O_CREATE|os.O_RDWR, 0o644)
	if err != nil {
		return nil, fmt.Errorf("open commit lock: %w", err)
	}
	if err := syscall.Flock(int(f.Fd()), syscall.LOCK_EX); err != nil {
		_ = f.Close()
		return nil, fmt.Errorf("lock %s: %w", f.Name(), err)
	}
	return func() {
		_ = syscall.Flock(int(f.Fd()), syscall.LOCK_UN)
		_ = f.Close()
	}, nil
}

var errEmptyTree = errors.New("attributed paths match HEAD")

// gitWith runs git in dir with extra environment and optional stdin.
func gitWith(dir string, env []string, stdin string, args ...string) (string, error) {
	cmd := exec.Command("git", append([]string{"--literal-pathspecs", "-C", dir}, args...)...)
	cmd.Env = append(os.Environ(), env...)
	if stdin != "" {
		cmd.Stdin = strings.NewReader(stdin)
	}
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("git %s: %w: %s", strings.Join(args, " "), err, strings.TrimSpace(stderr.String()))
	}
	return strings.TrimSpace(stdout.String()), nil
}

// commitPaths commits only paths, via a throwaway index seeded from HEAD, and
// advances the current branch. The real index is not touched.
func commitPaths(root string, paths []string, message string) (string, error) {
	tmpDir, err := os.MkdirTemp("", "ateam-itemcommit-")
	if err != nil {
		return "", fmt.Errorf("create temp index dir: %w", err)
	}
	defer os.RemoveAll(tmpDir)
	env := []string{"GIT_INDEX_FILE=" + filepath.Join(tmpDir, "index")}

	parent, err := gitWith(root, nil, "", "rev-parse", "--verify", "HEAD")
	if err != nil {
		return "", err
	}
	if _, err := gitWith(root, env, "", "read-tree", parent); err != nil {
		return "", err
	}
	if _, err := gitWith(root, env, strings.Join(paths, "\x00")+"\x00", "update-index", "--add", "--remove", "-z", "--stdin"); err != nil {
		return "", err
	}
	tree, err := gitWith(root, env, "", "write-tree")
	if err != nil {
		return "", err
	}
	parentTree, err := gitWith(root, nil, "", "rev-parse", parent+"^{tree}")
	if err != nil {
		return "", err
	}
	if tree == parentTree {
		return "", errEmptyTree
	}
	sha, err := gitWith(root, nil, message, "commit-tree", tree, "-p", parent, "-F", "-")
	if err != nil {
		return "", err
	}
	if _, err := gitWith(root, nil, "", "update-ref", "-m", "ateam item commit", "HEAD", sha, parent); err != nil {
		return "", err
	}
	return sha, nil
}

// resetIndexPaths makes the real index match HEAD for paths only, retrying
// while git's index.lock is held by someone else.
func resetIndexPaths(root string, paths []string) error {
	args := append([]string{"reset", "-q", "--"}, paths...)
	deadline := time.Now().Add(indexLockWait)
	for {
		_, err := gitWith(root, nil, "", args...)
		if err == nil {
			return nil
		}
		if !strings.Contains(err.Error(), "index.lock") || time.Now().After(deadline) {
			return err
		}
		time.Sleep(indexLockPoll)
	}
}
