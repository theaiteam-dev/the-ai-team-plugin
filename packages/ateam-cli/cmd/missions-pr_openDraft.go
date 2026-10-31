package cmd

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/spf13/cobra"

	"ateam/internal/client"
	"ateam/internal/itemcommit"
)

// recordedBranchPattern is the conservative set of characters a recorded
// mission branch may contain. It keeps the value from being read as a git or
// gh option and from carrying whitespace or control characters.
var recordedBranchPattern = regexp.MustCompile(`^[A-Za-z0-9._/-]+$`)

// openDraftRun runs an external command in dir without a shell and returns its
// combined output. Tests and callers go through this one seam.
var openDraftRun = func(dir, name string, args ...string) ([]byte, error) {
	c := exec.Command(name, args...)
	c.Dir = dir
	return c.CombinedOutput()
}

// repoPullRequestConfig mirrors the "pullRequest" block of ateam.config.json.
type repoPullRequestConfig struct {
	PullRequest *struct {
		Open *bool `json:"open"`
	} `json:"pullRequest"`
}

var missionsPrOpenDraftCmd = &cobra.Command{
	Use:   "openDraft",
	Short: "Push the mission branch and open a draft PR, or print the gh command when that is not possible",
	Long: `Pushes the branch recorded in /tmp/.ateam-pool/<missionId>/branch and opens a
draft pull request whose body is .qa-evidence/<missionId>/pr-description.md
(first line is the title).

When pullRequest.open is false in ateam.config.json, the repo has no remote, or
gh is missing or not authenticated, nothing is pushed or opened. The command
prints the description file path, the exact gh pr create command, and the
reason, then exits 0. An existing PR for the branch is reported, not duplicated.
The command never marks a PR ready and never merges one.`,
	Args: cobra.NoArgs,
	RunE: func(cmd *cobra.Command, args []string) error {
		baseURL, _ := cmd.Root().PersistentFlags().GetString("base-url")
		c := client.NewClient(baseURL, os.Getenv("ATEAM_TOKEN"))
		return runOpenDraft(c, cmd.OutOrStdout())
	},
}

func runOpenDraft(c *client.Client, out io.Writer) error {
	cwd, err := os.Getwd()
	if err != nil {
		return err
	}
	root, err := itemcommit.RepoRoot(cwd)
	if err != nil {
		return err
	}
	mission, err := fetchCurrentMission(c)
	if err != nil {
		return err
	}

	branch, err := readRecordedBranch(mission.ID)
	if err != nil {
		return err
	}
	descPath := filepath.Join(root, ".qa-evidence", mission.ID, "pr-description.md")
	title, err := readPRTitle(descPath)
	if err != nil {
		return err
	}
	open, err := pullRequestOpenEnabled(root)
	if err != nil {
		return err
	}

	if !open {
		return printManualPRCommand(out, descPath, title, branch,
			"pullRequest.open is false in ateam.config.json")
	}
	remote, err := pickRemote(root)
	if err != nil {
		return err
	}
	if remote == "" {
		return printManualPRCommand(out, descPath, title, branch, "this repo has no git remote")
	}
	if _, err := exec.LookPath("gh"); err != nil {
		return printManualPRCommand(out, descPath, title, branch, "gh is not installed (not found on PATH)")
	}
	if _, err := openDraftRun(root, "gh", "auth", "status"); err != nil {
		return printManualPRCommand(out, descPath, title, branch, "gh is not authenticated (gh auth status failed)")
	}

	refspec := "refs/heads/" + branch + ":refs/heads/" + branch
	if pushOut, err := openDraftRun(root, "git", "push", remote, refspec); err != nil {
		return fmt.Errorf("git push of %s to %s failed: %w\n%s", branch, remote, err, strings.TrimSpace(string(pushOut)))
	}

	if url := existingPRURL(root, branch); url != "" {
		fmt.Fprintf(out, "A pull request already exists for %s: %s\n", branch, url)
		return nil
	}

	createOut, err := openDraftRun(root, "gh", "pr", "create",
		"--draft", "--title", title, "--head", branch, "--body-file", descPath)
	if err != nil {
		return fmt.Errorf("gh pr create failed: %w\n%s", err, strings.TrimSpace(string(createOut)))
	}
	fmt.Fprintln(out, strings.TrimSpace(string(createOut)))
	return nil
}

// readRecordedBranch returns the branch recorded for the mission. A missing or
// empty record is an error: the command never falls back to the current HEAD.
func readRecordedBranch(missionID string) (string, error) {
	path := filepath.Join("/tmp/.ateam-pool", filepath.Base(missionID), "branch")
	raw, err := os.ReadFile(path)
	if err != nil {
		return "", fmt.Errorf("no recorded mission branch at %s: %w", path, err)
	}
	branch := strings.TrimSpace(string(raw))
	if branch == "" {
		return "", fmt.Errorf("recorded mission branch file %s is empty", path)
	}
	if strings.HasPrefix(branch, "-") || !recordedBranchPattern.MatchString(branch) {
		return "", fmt.Errorf("recorded mission branch %q in %s is not a valid branch name", branch, path)
	}
	return branch, nil
}

// readPRTitle returns the first line of the description file.
func readPRTitle(descPath string) (string, error) {
	raw, err := os.ReadFile(descPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return "", fmt.Errorf("%s does not exist: run 'ateam missions-pr describe' first", descPath)
		}
		return "", err
	}
	first := strings.TrimSpace(strings.SplitN(string(raw), "\n", 2)[0])
	if first == "" {
		return "", fmt.Errorf("%s has an empty first line, so there is no PR title: run 'ateam missions-pr describe' again", descPath)
	}
	return first, nil
}

// pullRequestOpenEnabled reads pullRequest.open from <root>/ateam.config.json.
// A missing file or a missing key means on. A file that cannot be parsed is an
// error, because pushing on the strength of a config we could not read would
// ignore a switch the user may have turned off.
func pullRequestOpenEnabled(root string) (bool, error) {
	raw, err := os.ReadFile(filepath.Join(root, "ateam.config.json"))
	if errors.Is(err, os.ErrNotExist) {
		return true, nil
	}
	if err != nil {
		return false, err
	}
	var cfg repoPullRequestConfig
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return false, fmt.Errorf("ateam.config.json is not valid JSON: %w", err)
	}
	if cfg.PullRequest == nil || cfg.PullRequest.Open == nil {
		return true, nil
	}
	return *cfg.PullRequest.Open, nil
}

// pickRemote returns "origin" when configured, else the first remote, else "".
func pickRemote(root string) (string, error) {
	raw, err := openDraftRun(root, "git", "remote")
	if err != nil {
		return "", fmt.Errorf("git remote failed: %w\n%s", err, strings.TrimSpace(string(raw)))
	}
	remotes := strings.Fields(string(raw))
	for _, r := range remotes {
		if r == "origin" {
			return r, nil
		}
	}
	if len(remotes) > 0 {
		return remotes[0], nil
	}
	return "", nil
}

// existingPRURL returns the URL of an open PR for branch, or "".
func existingPRURL(root, branch string) string {
	raw, err := openDraftRun(root, "gh", "pr", "view", branch, "--json", "url", "-q", ".url")
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(raw))
}

func printManualPRCommand(out io.Writer, descPath, title, branch, reason string) error {
	fmt.Fprintf(out, "Not opening a pull request: %s.\n", reason)
	fmt.Fprintf(out, "Description file: %s\n", descPath)
	fmt.Fprintln(out, "Open it yourself with:")
	fmt.Fprintf(out, "  gh pr create --draft --title %s --head %s --body-file %s\n",
		shellQuote(title), shellQuote(branch), shellQuote(descPath))
	return nil
}

// shellQuote wraps s in single quotes so a POSIX shell passes it through as one
// literal argument.
func shellQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}

func init() {
	missionsPrCmd.AddCommand(missionsPrOpenDraftCmd)
}
