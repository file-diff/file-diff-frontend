import test from "node:test";
import assert from "node:assert/strict";
import { buildCreateTaskRequestFields } from "../src/utils/createTaskSubmission.ts";

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
      custom_agent: "claude",
      model: "sonnet",
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
      agent_id: 17,
      custom_agent: "custom-runner",
      model: "gpt-5.4",
      reasoning_effort: "medium",
      reasoning_summary: "auto",
      task_delay_ms: 60000,
    }
  );
});
