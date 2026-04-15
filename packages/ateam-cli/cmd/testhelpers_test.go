package cmd

// This file contains test-only helpers for resetting cobra command state
// between test runs. Cobra caches both the module-level flag variables and
// the per-flag Changed() status on the *shared* rootCmd, so two tests that
// run the same subcommand with different flags will see each other's state
// unless we reset explicitly. This code intentionally lives in a _test.go
// file so it is NOT compiled into production binaries — production RunE
// handlers must never contain test-scaffolding state cleanup.

// resetScalingComputeFlagsForTest clears both the module variables and the
// cobra flag Changed() status for the `scaling compute` subcommand.
func resetScalingComputeFlagsForTest() {
	scalingComputeCmd_concurrency = 0
	scalingComputeCmd_memory = 0
	if f := scalingComputeCmd.Flags().Lookup("concurrency"); f != nil {
		f.Changed = false
		f.Value.Set("0")
	}
	if f := scalingComputeCmd.Flags().Lookup("memory"); f != nil {
		f.Changed = false
		f.Value.Set("0")
	}
}

// resetMissionsCreateMissionFlagsForTest clears both the module variables and
// the cobra flag Changed() status for the `missions createMission` subcommand.
func resetMissionsCreateMissionFlagsForTest() {
	missionsCreateMissionCmdBody = ""
	missionsCreateMissionCmdBodyFile = ""
	missionsCreateMissionCmd_force = false
	missionsCreateMissionCmd_name = ""
	missionsCreateMissionCmd_prdPath = ""
	missionsCreateMissionCmd_concurrency = 0
	if f := missionsCreateMissionCmd.Flags().Lookup("concurrency"); f != nil {
		f.Changed = false
		f.Value.Set("0")
	}
	if f := missionsCreateMissionCmd.Flags().Lookup("body"); f != nil {
		f.Changed = false
		f.Value.Set("")
	}
	if f := missionsCreateMissionCmd.Flags().Lookup("body-file"); f != nil {
		f.Changed = false
		f.Value.Set("")
	}
	if f := missionsCreateMissionCmd.Flags().Lookup("force"); f != nil {
		f.Changed = false
		f.Value.Set("false")
	}
	if f := missionsCreateMissionCmd.Flags().Lookup("name"); f != nil {
		f.Changed = false
		f.Value.Set("")
	}
	if f := missionsCreateMissionCmd.Flags().Lookup("prdPath"); f != nil {
		f.Changed = false
		f.Value.Set("")
	}
}

// resetAgentsStopAgentStopFlagsForTest clears module variables and cobra flag
// Changed() status for the `agents-stop agentStop` subcommand.
func resetAgentsStopAgentStopFlagsForTest() {
	agentsStopAgentStopCmdBody = ""
	agentsStopAgentStopCmdBodyFile = ""
	agentsStopAgentStopCmd_agent = ""
	agentsStopAgentStopCmd_advance = true
	agentsStopAgentStopCmd_itemId = ""
	agentsStopAgentStopCmd_outcome = ""
	agentsStopAgentStopCmd_returnTo = ""
	agentsStopAgentStopCmd_summary = ""
	flags := agentsStopAgentStopCmd.Flags()
	for _, name := range []string{"body", "body-file", "agent", "itemId", "outcome", "return-to", "summary"} {
		if f := flags.Lookup(name); f != nil {
			f.Changed = false
			f.Value.Set("")
		}
	}
	if f := flags.Lookup("advance"); f != nil {
		f.Changed = false
		f.Value.Set("true")
	}
}
