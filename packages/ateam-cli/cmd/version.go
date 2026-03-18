package cmd

// Version is set at build time via -ldflags "-X ateam/cmd.Version=vX.Y.Z".
// Falls back to "dev" for local builds.
var Version = "dev"
