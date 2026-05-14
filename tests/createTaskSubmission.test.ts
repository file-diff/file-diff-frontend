import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCreateTaskRequestFields,
  normalizeModelSelection,
} from "../src/utils/createTaskSubmission.ts";

test("claude tasks send the selected model without forcing custom_agent", () => {
  assert.deepEqual(
    buildCreateTaskRequestFields({
      customAgent: "",
      model: "opus",
      reasoningEffort: "",
      reasoningSummary: "",
      task: "claude",
    }),
    {
      task: "claude",
      model: "opus",
    }
  );
});

test("custom agent remains an independent override field", () => {
  assert.deepEqual(
    buildCreateTaskRequestFields({
      customAgent: "claude",
      model: "sonnet",
      reasoningEffort: "",
      reasoningSummary: "",
      task: "claude",
    }),
    {
      task: "claude",
      custom_agent: "claude",
      model: "sonnet",
    }
  );
});

test("opencode tasks send the selected deepseek model", () => {
  assert.deepEqual(
    buildCreateTaskRequestFields({
      customAgent: "",
      model: "deepseek-v4-flash",
      reasoningEffort: "",
      reasoningSummary: "",
      task: "opencode",
    }),
    {
      task: "opencode",
      model: "deepseek-v4-flash",
    }
  );
});

test("codex tasks keep codex-only options in the payload", () => {
  assert.deepEqual(
    buildCreateTaskRequestFields({
      agentId: 17,
      customAgent: "custom-runner",
      model: "gpt-5.4",
      reasoningEffort: "medium",
      reasoningSummary: "auto",
      task: "codex",
      taskDelayMs: 60000,
    }),
    {
      task: "codex",
      agent_id: 17,
      custom_agent: "custom-runner",
      model: "gpt-5.4",
      reasoning_effort: "medium",
      reasoning_summary: "auto",
      task_delay_ms: 60000,
    }
  );
});

test("codex tasks default to gpt-5.5 with high detailed reasoning", () => {
  assert.deepEqual(
    buildCreateTaskRequestFields({
      customAgent: "",
      model: "",
      reasoningEffort: "",
      reasoningSummary: "",
      task: "codex",
    }),
    {
      task: "codex",
      model: "gpt-5.5",
      reasoning_effort: "high",
      reasoning_summary: "detailed",
    }
  );
});

test("invalid codex model selections normalize to gpt-5.5", () => {
  assert.equal(normalizeModelSelection("codex", "gpt-4.1"), "gpt-5.5");
});

test("system prompt is forwarded for codex tasks", () => {
  assert.deepEqual(
    buildCreateTaskRequestFields({
      customAgent: "",
      model: "gpt-5.5",
      reasoningEffort: "",
      reasoningSummary: "",
      systemPrompt: "You are a helpful assistant.",
      task: "codex",
    }),
    {
      task: "codex",
      model: "gpt-5.5",
      reasoning_effort: "high",
      reasoning_summary: "detailed",
      system_prompt: "You are a helpful assistant.",
    }
  );
});

test("system prompt is forwarded for opencode tasks", () => {
  assert.deepEqual(
    buildCreateTaskRequestFields({
      customAgent: "",
      model: "deepseek-v4-pro",
      reasoningEffort: "",
      reasoningSummary: "",
      systemPrompt: "Stay concise.",
      task: "opencode",
    }),
    {
      task: "opencode",
      model: "deepseek-v4-pro",
      system_prompt: "Stay concise.",
    }
  );
});

test("system prompt is omitted for claude tasks even when provided", () => {
  assert.deepEqual(
    buildCreateTaskRequestFields({
      customAgent: "",
      model: "opus",
      reasoningEffort: "",
      reasoningSummary: "",
      systemPrompt: "Claude does not accept this.",
      task: "claude",
    }),
    {
      task: "claude",
      model: "opus",
    }
  );
});

test("blank system prompt does not add the field", () => {
  assert.deepEqual(
    buildCreateTaskRequestFields({
      customAgent: "",
      model: "gpt-5.5",
      reasoningEffort: "",
      reasoningSummary: "",
      systemPrompt: "   ",
      task: "codex",
    }),
    {
      task: "codex",
      model: "gpt-5.5",
      reasoning_effort: "high",
      reasoning_summary: "detailed",
    }
  );
});
