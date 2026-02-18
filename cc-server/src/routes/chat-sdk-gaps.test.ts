/**
 * SDK Gap Analysis — Unused Claude Agent SDK Capabilities
 *
 * Each test.todo() documents an SDK feature not yet used by cc-server.
 * These serve as a built-in roadmap for future enhancements.
 *
 * When implementing a feature, convert its test.todo() to a real test
 * and add the corresponding server-side integration.
 */

import { describe, it } from "vitest";

describe("SDK Feature Gaps — Roadmap", () => {
  // ── Query-level controls ──────────────────────────────────────────

  it.todo(
    "Mid-query model switch — query.setModel() — Change models without restarting the session"
  );

  it.todo(
    "Thinking budget — query.setMaxThinkingTokens() — Control reasoning cost per query"
  );

  it.todo(
    "Graceful interrupt — query.interrupt() — Stop query cleanly without abort signal"
  );

  // ── File operations ───────────────────────────────────────────────

  it.todo(
    "File checkpointing — enableFileCheckpointing + query.rewindFiles() — Undo file changes to a previous state"
  );

  // ── MCP ───────────────────────────────────────────────────────────

  it.todo(
    "Dynamic MCP — query.setMcpServers() — Add/remove MCP servers live during a session"
  );

  // ── Output format ─────────────────────────────────────────────────

  it.todo(
    "Structured output — outputFormat: { type: 'json_schema' } — Force JSON responses with schema validation"
  );

  // ── Hooks ─────────────────────────────────────────────────────────

  it.todo(
    "Hooks — options.hooks (PreToolUse, PostToolUse) — Intercept/modify tool calls before and after execution"
  );

  // ── Limits ────────────────────────────────────────────────────────

  it.todo(
    "Cost limits — options.maxBudgetUsd — Auto-stop query at a budget threshold"
  );

  it.todo(
    "Turn limits — options.maxTurns — Cap conversation turns per query"
  );

  // ── Session management ────────────────────────────────────────────

  it.todo(
    "Fork session — options.forkSession — Branch conversation without affecting original session"
  );

  it.todo(
    "Continue — options.continue — Resume most recent conversation automatically"
  );

  // ── Permission modes ──────────────────────────────────────────────

  it.todo(
    "Delegate mode — permissionMode: 'delegate' — Restrict agent to Task tools only"
  );

  it.todo(
    "DontAsk mode — permissionMode: 'dontAsk' — Deny all permissions unless pre-approved"
  );

  // ── Extended capabilities ─────────────────────────────────────────

  it.todo(
    "1M context beta — betas: ['context-1m-2025-08-07'] — Extended context window for large codebases"
  );

  it.todo(
    "Custom subagents — options.agents — Define programmable agent types with custom tools and instructions"
  );

  // ── Account info ──────────────────────────────────────────────────

  it.todo(
    "Account info — query.accountInfo() — Show authenticated user details and usage limits"
  );
});
