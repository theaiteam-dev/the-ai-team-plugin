package cmd

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
)

func TestPoolClaimHappyPath(t *testing.T) {
	_, poolDir := withTempPoolRoot(t, "claim-happy")
	if err := os.MkdirAll(poolDir, 0755); err != nil {
		t.Fatalf("mkdir pool: %v", err)
	}
	idleFile := filepath.Join(poolDir, "murdock-1.idle")
	if err := os.WriteFile(idleFile, nil, 0644); err != nil {
		t.Fatalf("writing idle file: %v", err)
	}

	out, err := runPoolCmd(t, "pool", "claim", "murdock-1")
	if err != nil {
		t.Fatalf("claim failed: %v\noutput: %s", err, out)
	}

	if _, statErr := os.Stat(idleFile); !os.IsNotExist(statErr) {
		t.Errorf("expected %s to be gone, stat err=%v", idleFile, statErr)
	}
	busyFile := filepath.Join(poolDir, "murdock-1.busy")
	if _, statErr := os.Stat(busyFile); statErr != nil {
		t.Errorf("expected %s to exist, stat err=%v", busyFile, statErr)
	}
	// Claim is the normal hot path — must NOT print POOL_WARN.
	if strings.Contains(out, "POOL_WARN") {
		t.Errorf("expected NO POOL_WARN on claim, got: %s", out)
	}
}

func TestPoolClaimMissingMissionID(t *testing.T) {
	t.Setenv("ATEAM_MISSION_ID", "")

	out, err := runPoolCmd(t, "pool", "claim", "murdock-1")
	if err == nil {
		t.Fatalf("expected error when ATEAM_MISSION_ID is unset, got output: %s", out)
	}
	if !strings.Contains(err.Error(), "ATEAM_MISSION_ID") {
		t.Errorf("expected error to mention ATEAM_MISSION_ID, got: %v", err)
	}
}

func TestPoolClaimErrorsWhenPoolDirMissing(t *testing.T) {
	_, poolDir := withTempPoolRoot(t, "claim-no-dir")
	// Ensure pool dir does NOT exist
	_ = os.RemoveAll(poolDir)

	out, err := runPoolCmd(t, "pool", "claim", "murdock-1")
	if err == nil {
		t.Fatalf("expected error when pool dir missing, got output: %s", out)
	}
	if !strings.Contains(err.Error(), "pool init") {
		t.Errorf("expected error to mention 'pool init', got: %v", err)
	}
}

func TestPoolClaimErrorsWhenAlreadyClaimed(t *testing.T) {
	_, poolDir := withTempPoolRoot(t, "claim-already")
	if err := os.MkdirAll(poolDir, 0755); err != nil {
		t.Fatalf("mkdir pool: %v", err)
	}
	// .idle missing, .busy present → already claimed
	busyFile := filepath.Join(poolDir, "murdock-1.busy")
	if err := os.WriteFile(busyFile, nil, 0644); err != nil {
		t.Fatalf("writing busy: %v", err)
	}

	out, err := runPoolCmd(t, "pool", "claim", "murdock-1")
	if err == nil {
		t.Fatalf("expected error when slot already claimed, got output: %s", out)
	}
	if !strings.Contains(strings.ToLower(err.Error()), "already claimed") {
		t.Errorf("expected error to mention 'already claimed', got: %v", err)
	}
	// .busy must still be there, untouched
	if _, statErr := os.Stat(busyFile); statErr != nil {
		t.Errorf("busy file should be untouched, stat err=%v", statErr)
	}
}

func TestPoolClaimErrorsWhenNoSuchInstance(t *testing.T) {
	_, poolDir := withTempPoolRoot(t, "claim-no-instance")
	if err := os.MkdirAll(poolDir, 0755); err != nil {
		t.Fatalf("mkdir pool: %v", err)
	}
	// Neither .idle nor .busy

	out, err := runPoolCmd(t, "pool", "claim", "murdock-1")
	if err == nil {
		t.Fatalf("expected error when no .idle or .busy exists, got output: %s", out)
	}
	if !strings.Contains(strings.ToLower(err.Error()), "no such instance") {
		t.Errorf("expected error to mention 'no such instance', got: %v", err)
	}
	if !strings.Contains(err.Error(), "mark-idle") {
		t.Errorf("expected error to reference mark-idle, got: %v", err)
	}
}

func TestPoolClaimErrorsWhenCorruptedState(t *testing.T) {
	_, poolDir := withTempPoolRoot(t, "claim-corrupt")
	if err := os.MkdirAll(poolDir, 0755); err != nil {
		t.Fatalf("mkdir pool: %v", err)
	}
	idleFile := filepath.Join(poolDir, "murdock-1.idle")
	busyFile := filepath.Join(poolDir, "murdock-1.busy")
	if err := os.WriteFile(idleFile, nil, 0644); err != nil {
		t.Fatalf("writing idle: %v", err)
	}
	if err := os.WriteFile(busyFile, nil, 0644); err != nil {
		t.Fatalf("writing busy: %v", err)
	}

	out, err := runPoolCmd(t, "pool", "claim", "murdock-1")
	if err == nil {
		t.Fatalf("expected error when both .idle and .busy exist, got output: %s", out)
	}
	if !strings.Contains(strings.ToLower(err.Error()), "corrupt") {
		t.Errorf("expected error to mention 'corrupt', got: %v", err)
	}
	// Both files must remain untouched
	if _, statErr := os.Stat(idleFile); statErr != nil {
		t.Errorf("idle file should be untouched, stat err=%v", statErr)
	}
	if _, statErr := os.Stat(busyFile); statErr != nil {
		t.Errorf("busy file should be untouched, stat err=%v", statErr)
	}
}

func TestPoolClaimRequiresInstanceArg(t *testing.T) {
	_, poolDir := withTempPoolRoot(t, "claim-no-arg")
	if err := os.MkdirAll(poolDir, 0755); err != nil {
		t.Fatalf("mkdir pool: %v", err)
	}

	_, err := runPoolCmd(t, "pool", "claim")
	if err == nil {
		t.Fatalf("expected error when instance arg missing")
	}
}

func TestPoolClaimJSONOutput(t *testing.T) {
	_, poolDir := withTempPoolRoot(t, "claim-json")
	if err := os.MkdirAll(poolDir, 0755); err != nil {
		t.Fatalf("mkdir pool: %v", err)
	}
	idleFile := filepath.Join(poolDir, "ba-2.idle")
	if err := os.WriteFile(idleFile, nil, 0644); err != nil {
		t.Fatalf("writing idle: %v", err)
	}

	out, err := runPoolCmd(t, "pool", "claim", "ba-2", "--json")
	if err != nil {
		t.Fatalf("claim --json failed: %v\noutput: %s", err, out)
	}

	var parsed map[string]interface{}
	if jerr := json.Unmarshal([]byte(extractJSON(out)), &parsed); jerr != nil {
		t.Fatalf("unmarshal: %v\nraw: %s", jerr, out)
	}
	if parsed["instance"] != "ba-2" {
		t.Errorf("expected instance=ba-2, got %v", parsed["instance"])
	}
	if parsed["state"] != "busy" {
		t.Errorf("expected state=busy, got %v", parsed["state"])
	}
	expectedPath := filepath.Join(poolDir, "ba-2.busy")
	if parsed["path"] != expectedPath {
		t.Errorf("expected path=%q, got %v", expectedPath, parsed["path"])
	}
}

// TestPoolClaimExitCodes asserts that each error path returns a *PoolError
// carrying the documented exit code. The pool-handoff skill consumes these
// codes (specifically code 2 = already claimed = success), so the contract
// is load-bearing — substring matching on error messages is fragile.
func TestPoolClaimExitCodes(t *testing.T) {
	cases := []struct {
		name string
		// setup runs in a fresh per-test pool dir; the dir is created for you
		// unless skipMkdir is true (used for the "no pool dir" case).
		setup     func(t *testing.T, poolDir string)
		skipMkdir bool
		argv      []string
		wantExit  int
	}{
		{
			name: "happy path returns 0",
			setup: func(t *testing.T, poolDir string) {
				if err := os.WriteFile(filepath.Join(poolDir, "murdock-1.idle"), nil, 0644); err != nil {
					t.Fatalf("seed: %v", err)
				}
			},
			argv:     []string{"pool", "claim", "murdock-1"},
			wantExit: PoolExitOK,
		},
		{
			name:      "missing pool dir returns 5",
			skipMkdir: true,
			argv:      []string{"pool", "claim", "murdock-1"},
			wantExit:  PoolExitPoolDirMissing,
		},
		{
			name: "already claimed returns 2",
			setup: func(t *testing.T, poolDir string) {
				if err := os.WriteFile(filepath.Join(poolDir, "murdock-1.busy"), nil, 0644); err != nil {
					t.Fatalf("seed: %v", err)
				}
			},
			argv:     []string{"pool", "claim", "murdock-1"},
			wantExit: PoolExitAlreadyClaimed,
		},
		{
			name:     "no such instance returns 3",
			setup:    func(t *testing.T, poolDir string) {},
			argv:     []string{"pool", "claim", "murdock-1"},
			wantExit: PoolExitNoSuchInstance,
		},
		{
			name: "corrupted state returns 4",
			setup: func(t *testing.T, poolDir string) {
				_ = os.WriteFile(filepath.Join(poolDir, "murdock-1.idle"), nil, 0644)
				_ = os.WriteFile(filepath.Join(poolDir, "murdock-1.busy"), nil, 0644)
			},
			argv:     []string{"pool", "claim", "murdock-1"},
			wantExit: PoolExitCorruptedState,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, poolDir := withTempPoolRoot(t, "claim-codes-"+strings.ReplaceAll(tc.name, " ", "-"))
			_ = os.RemoveAll(poolDir)
			if !tc.skipMkdir {
				if err := os.MkdirAll(poolDir, 0755); err != nil {
					t.Fatalf("mkdir: %v", err)
				}
			}
			if tc.setup != nil {
				tc.setup(t, poolDir)
			}

			_, err := runPoolCmd(t, tc.argv...)

			if tc.wantExit == PoolExitOK {
				if err != nil {
					t.Fatalf("expected exit 0, got err: %v", err)
				}
				return
			}
			if err == nil {
				t.Fatalf("expected error with exit code %d, got nil", tc.wantExit)
			}
			var pe *PoolError
			if !errors.As(err, &pe) {
				t.Fatalf("expected *PoolError, got %T: %v", err, err)
			}
			if pe.ExitCode != tc.wantExit {
				t.Errorf("expected exit code %d, got %d (msg: %s)", tc.wantExit, pe.ExitCode, pe.Message)
			}
		})
	}
}

func TestPoolClaimRaceSafety(t *testing.T) {
	_, poolDir := withTempPoolRoot(t, "claim-race")
	if err := os.MkdirAll(poolDir, 0755); err != nil {
		t.Fatalf("mkdir pool: %v", err)
	}
	idleFile := filepath.Join(poolDir, "lynch-1.idle")
	if err := os.WriteFile(idleFile, nil, 0644); err != nil {
		t.Fatalf("writing idle: %v", err)
	}

	// Two goroutines race to claim the same slot. Exactly one must win.
	// We bypass runPoolCmd because cobra's rootCmd is not goroutine-safe
	// (shared buffer + SetArgs). Instead, replicate the verb's atomic step
	// — os.Rename — which is what the production code must rely on.
	//
	// NOTE: This test only verifies os.Rename's atomicity — a known-good
	// primitive. The cross-process race test below
	// (TestPoolClaimCrossProcessRace) is the load-bearing one: it spawns
	// the actual built binary so the stat-then-rename window in pool_claim.go
	// is exercised under contention.
	missionID := os.Getenv("ATEAM_MISSION_ID")
	if missionID == "" {
		t.Fatal("missionID empty — withTempPoolRoot didn't set it")
	}
	src := filepath.Join(poolDir, "lynch-1.idle")
	dst := filepath.Join(poolDir, "lynch-1.busy")

	var wg sync.WaitGroup
	var successes int32
	var failures int32
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := os.Rename(src, dst); err == nil {
				atomic.AddInt32(&successes, 1)
			} else {
				atomic.AddInt32(&failures, 1)
			}
		}()
	}
	wg.Wait()

	if successes != 1 {
		t.Errorf("expected exactly 1 successful rename, got %d", successes)
	}
	if failures != 1 {
		t.Errorf("expected exactly 1 failed rename, got %d", failures)
	}
	if _, statErr := os.Stat(dst); statErr != nil {
		t.Errorf("expected %s to exist after race, stat err=%v", dst, statErr)
	}
	if _, statErr := os.Stat(src); !os.IsNotExist(statErr) {
		t.Errorf("expected %s to be gone after race, stat err=%v", src, statErr)
	}
}

// buildPoolBinaryOnce builds the ateam binary once per test process and
// returns its path. Subsequent callers reuse the cached binary.
//
// Cross-process race tests spawn this binary in real subprocesses, which is
// the only way to exercise pool_claim.go's stat-then-rename window under
// concurrent contention — in-process goroutines hit cobra's shared rootCmd
// buffer.
//
// We build into os.MkdirTemp (NOT t.TempDir) so the binary survives across
// `-count=N` re-runs of the same test. testing.T cleans up t.TempDir after
// each Run; the sync.Once would refuse to rebuild on the second iteration.
var (
	poolBinaryOnce sync.Once
	poolBinaryPath string
	poolBinaryErr  error
)

func buildPoolBinary(t *testing.T) string {
	t.Helper()
	poolBinaryOnce.Do(func() {
		dir, err := os.MkdirTemp("", "ateam-pool-claim-bin-")
		if err != nil {
			poolBinaryErr = fmt.Errorf("mktemp: %w", err)
			return
		}
		bin := filepath.Join(dir, "ateam-test-bin")
		// Build the package this test lives in. cmd is package main's only
		// dependency, but the binary entry point is at the parent module
		// root (../main.go from cmd/). go build with the module path picks
		// up main automatically.
		cmd := exec.Command("go", "build", "-o", bin, "..")
		cmd.Dir = "."
		out, err := cmd.CombinedOutput()
		if err != nil {
			poolBinaryErr = fmt.Errorf("go build failed: %v\n%s", err, out)
			return
		}
		poolBinaryPath = bin
	})
	if poolBinaryErr != nil {
		t.Fatalf("build pool binary: %v", poolBinaryErr)
	}
	if poolBinaryPath == "" {
		t.Fatal("pool binary path empty after build")
	}
	return poolBinaryPath
}

// TestPoolClaimCrossProcessRace exercises the production verb under real
// concurrent contention. Two child processes race to claim the same .idle
// file; exactly one must exit 0 and the other must exit 2 (already claimed).
//
// We run the race many iterations to shake out timing-dependent flakes —
// the stat-then-rename window in pool_claim.go is small but real, and a
// single-iteration test could pass by luck.
func TestPoolClaimCrossProcessRace(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping cross-process race in -short mode")
	}
	bin := buildPoolBinary(t)

	const iterations = 50
	for i := 0; i < iterations; i++ {
		missionID := fmt.Sprintf("M-test-cross-race-%d", i)
		poolDir := filepath.Join("/tmp/.ateam-pool", missionID)
		if err := os.MkdirAll(poolDir, 0755); err != nil {
			t.Fatalf("iter %d: mkdir: %v", i, err)
		}
		t.Cleanup(func() { _ = os.RemoveAll(poolDir) })

		idleFile := filepath.Join(poolDir, "murdock-1.idle")
		if err := os.WriteFile(idleFile, nil, 0644); err != nil {
			t.Fatalf("iter %d: seed idle: %v", i, err)
		}

		var wg sync.WaitGroup
		var exits [2]int
		for j := 0; j < 2; j++ {
			wg.Add(1)
			go func(slot int) {
				defer wg.Done()
				cmd := exec.Command(bin, "pool", "claim", "murdock-1")
				cmd.Env = append(os.Environ(), "ATEAM_MISSION_ID="+missionID)
				err := cmd.Run()
				if err == nil {
					exits[slot] = 0
					return
				}
				var ee *exec.ExitError
				if errors.As(err, &ee) {
					exits[slot] = ee.ExitCode()
					return
				}
				t.Errorf("iter %d slot %d: unexpected error: %v", i, slot, err)
				exits[slot] = -1
			}(j)
		}
		wg.Wait()

		zeros := 0
		twos := 0
		for _, code := range exits {
			switch code {
			case 0:
				zeros++
			case PoolExitAlreadyClaimed:
				twos++
			}
		}
		if zeros != 1 || twos != 1 {
			t.Fatalf("iter %d: expected exactly one exit=0 and one exit=%d, got %v",
				i, PoolExitAlreadyClaimed, exits)
		}

		// Filesystem invariant: .busy exists, .idle is gone.
		busyFile := filepath.Join(poolDir, "murdock-1.busy")
		if _, err := os.Stat(busyFile); err != nil {
			t.Errorf("iter %d: expected %s to exist, got: %v", i, busyFile, err)
		}
		if _, err := os.Stat(idleFile); !os.IsNotExist(err) {
			t.Errorf("iter %d: expected %s to be gone, got stat: %v", i, idleFile, err)
		}
	}
}
