import { randomBytes } from "node:crypto";
import { homedir, userInfo } from "node:os";
import { join, resolve } from "node:path";

export interface Config {
  /** The local SQLite file. Profiles never leave this machine. */
  dbPath: string;
  /** Root of the repository Claude Code is working in. */
  projectDir: string;
  /** Where the Markdown ticket adapter looks for tickets. */
  ticketsDir: string;
  /** Who the observations and growth plans belong to. Local only. */
  developerId: string;
  /** Groups the decisions of one coding session. */
  sessionId: string;
}

/** A value counts as set when it is non-empty and not an unexpanded ${VAR}. */
function setValue(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes("${")) return undefined;
  return trimmed;
}

function defaultDeveloperId(): string {
  try {
    return userInfo().username || "local";
  } catch {
    return "local";
  }
}

export function newSessionId(now: Date = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").slice(0, 15);
  return `sess_${stamp}_${randomBytes(3).toString("hex")}`;
}

/**
 * Environment variables (all optional):
 *
 *   FTC_DB_PATH        SQLite file. Default: ~/.ftc/ftc.sqlite
 *   FTC_PROJECT_DIR    Repository root. The plugin sets it from CLAUDE_PROJECT_DIR.
 *   FTC_TICKETS_DIR    Markdown tickets. Default: <project>/tickets
 *   FTC_DEVELOPER_ID   Default: the OS user name
 *   CLAUDE_SESSION_ID  Default: a new id per server process
 */
export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): Config {
  const projectDir = resolve(
    setValue(env.FTC_PROJECT_DIR) ?? setValue(env.CLAUDE_PROJECT_DIR) ?? cwd,
  );
  return {
    dbPath: resolve(setValue(env.FTC_DB_PATH) ?? join(homedir(), ".ftc", "ftc.sqlite")),
    projectDir,
    ticketsDir: resolve(setValue(env.FTC_TICKETS_DIR) ?? join(projectDir, "tickets")),
    developerId: setValue(env.FTC_DEVELOPER_ID) ?? defaultDeveloperId(),
    sessionId: setValue(env.CLAUDE_SESSION_ID) ?? newSessionId(),
  };
}
