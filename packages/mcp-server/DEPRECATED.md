# DEPRECATED: MCP Server

This package has been retired. The MCP server is no longer the communication layer for A(i)-Team agents.

## Replacement

Agents now use the **`ateam` CLI binary** located at `packages/ateam-cli/`.

The `ateam` CLI provides the same board, item, agent lifecycle, mission, and utility operations previously exposed as MCP tools, but as a standalone binary that agents invoke via `Bash(ateam ...)` calls.

## Why

- No MCP server process required at startup
- Simpler installation and configuration
- Direct HTTP communication with the A(i)-Team API
- No dependency on Claude Code's MCP hosting infrastructure

## Source Code

The source code in this package is preserved for historical reference. Do not build or deploy it.
