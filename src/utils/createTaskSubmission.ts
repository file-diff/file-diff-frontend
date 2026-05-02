import type {
  CreateTaskRequest,
  CreateTaskRunner,
  ReasoningEffort,
  ReasoningSummary,
} from "./repositorySelection";

export const CODEX_DEFAULT_MODEL = "gpt-5.2-codex";
export const DEFAULT_CODEX_MODEL = "";
export const CLAUDE_MODEL_VALUES = ["sonnet", "opus"] as const;
export const DEFAULT_CLAUDE_MODEL = CLAUDE_MODEL_VALUES[0];
export const OPENCODE_MODEL_VALUES = [
  "deepseek-v4-pro",
  "deepseek-v4-flash",
] as const;
export const DEFAULT_OPENCODE_MODEL = OPENCODE_MODEL_VALUES[0];
export const CODEX_MODEL_VALUES = [
  "gpt-5.5",
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.3-codex",
  "gpt-5.3-codex-spark",
  "gpt-5.2-codex",
] as const;

function isCodexModel(value: string): boolean {
  return (CODEX_MODEL_VALUES as readonly string[]).includes(value);
}

function isClaudeModel(value: string): boolean {
  return CLAUDE_MODEL_VALUES.includes(
    value as (typeof CLAUDE_MODEL_VALUES)[number]
  );
}

function isOpencodeModel(value: string): boolean {
  return OPENCODE_MODEL_VALUES.includes(
    value as (typeof OPENCODE_MODEL_VALUES)[number]
  );
}

export function normalizeModelSelection(
  task: CreateTaskRunner,
  value: string | undefined
): string {
  const trimmed = value?.trim() ?? "";

  if (task === "claude") {
    return isClaudeModel(trimmed) ? trimmed : DEFAULT_CLAUDE_MODEL;
  }

  if (task === "opencode") {
    return isOpencodeModel(trimmed) ? trimmed : DEFAULT_OPENCODE_MODEL;
  }

  return isCodexModel(trimmed) ? trimmed : DEFAULT_CODEX_MODEL;
}

interface BuildCreateTaskRequestFieldsArgs {
  agentId?: number;
  customAgent: string;
  model: string;
  reasoningEffort: ReasoningEffort | "";
  reasoningSummary: ReasoningSummary | "";
  task: CreateTaskRunner;
  taskDelayMs?: number;
}

export function buildCreateTaskRequestFields({
  agentId,
  customAgent,
  model,
  reasoningEffort,
  reasoningSummary,
  task,
  taskDelayMs,
}: BuildCreateTaskRequestFieldsArgs): Partial<CreateTaskRequest> {
  const request: Partial<CreateTaskRequest> = { task };
  const validatedModel = normalizeModelSelection(task, model);
  const validatedCustomAgent = customAgent.trim();

  if (agentId !== undefined) {
    request.agent_id = agentId;
  }
  if (validatedModel) {
    request.model = validatedModel;
  }
  if (validatedCustomAgent) {
    request.custom_agent = validatedCustomAgent;
  }
  if (task === "codex" && reasoningEffort) {
    request.reasoning_effort = reasoningEffort;
  }
  if (task === "codex" && reasoningSummary) {
    request.reasoning_summary = reasoningSummary;
  }
  if (typeof taskDelayMs === "number") {
    request.task_delay_ms = taskDelayMs;
  }

  return request;
}
