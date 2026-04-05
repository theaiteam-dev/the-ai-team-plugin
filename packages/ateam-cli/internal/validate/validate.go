package validate

import (
	"fmt"
	"regexp"
	"strings"
)

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
