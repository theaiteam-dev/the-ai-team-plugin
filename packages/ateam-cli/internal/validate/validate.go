package validate

import (
	"fmt"
	"regexp"
	"strings"

	"github.com/spf13/cobra"
)

// RequireFlags checks that each named flag was explicitly set on the command.
// This is used in place of cobra's MarkFlagRequired for commands that also
// accept --body / --body-file as an alternative to individual flags: cobra's
// built-in required-flag enforcement runs before RunE and cannot be bypassed,
// so --body-file alone is rejected with "required flag(s) not set" even
// though the body file provides those values. Call this helper from RunE
// after the body/body-file branch has been handled.
//
// The error message mirrors cobra's native format so users see consistent
// output regardless of which path flagged the missing values.
func RequireFlags(cmd *cobra.Command, names ...string) error {
	var missing []string
	for _, name := range names {
		if !cmd.Flags().Changed(name) {
			missing = append(missing, fmt.Sprintf("%q", name))
		}
	}
	if len(missing) > 0 {
		return fmt.Errorf("required flag(s) %s not set", strings.Join(missing, ", "))
	}
	return nil
}

// Enum checks that val is one of the allowed values.
// Returns nil if val is empty (flag not set). Call only after cmd.Flags().Changed().
func Enum(flagName, val string, allowed []string) error {
	for _, a := range allowed {
		if a == val {
			return nil
		}
	}
	return fmt.Errorf("invalid value %q for --%s: must be one of: %s", val, flagName, strings.Join(allowed, ", "))
}

var instanceSuffix = regexp.MustCompile(`-\d+$`)

// NormalizeAgentType extracts the pool role from an agent name or instance name.
// Lowercases, strips dots, and strips any numeric instance suffix.
// e.g. "murdock-2" → "murdock", "B.A." → "ba", "lynch-1" → "lynch"
func NormalizeAgentType(name string) string {
	return instanceSuffix.ReplaceAllString(
		strings.ToLower(strings.ReplaceAll(name, ".", "")),
		"",
	)
}

// AgentName checks that val is a valid agent name, accepting both canonical names
// (e.g. "Murdock") and multi-instance variants (e.g. "murdock-1", "ba-2").
func AgentName(flagName, val string, allowed []string) error {
	// Strip instance suffix and normalize before checking
	normalized := strings.ToLower(strings.ReplaceAll(val, ".", ""))
	normalized = instanceSuffix.ReplaceAllString(normalized, "")
	for _, a := range allowed {
		if strings.ToLower(strings.ReplaceAll(a, ".", "")) == normalized {
			return nil
		}
	}
	return fmt.Errorf("invalid value %q for --%s: must be one of: %s (or a numbered instance like murdock-1)", val, flagName, strings.Join(allowed, ", "))
}
