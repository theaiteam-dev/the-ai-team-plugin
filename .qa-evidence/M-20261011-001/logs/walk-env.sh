# Sourced before every sandbox command in Frankie's walk.
unset ATEAM_MISSION_ID ATEAM_PROJECT_ID ATEAM_API_URL
source /home/josh/Code/TheAITeam/the-ai-team-plugin/.qa-evidence/M-20261011-001/logs/sandbox-env.sh
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
cd "$SANDBOX_REPO"
