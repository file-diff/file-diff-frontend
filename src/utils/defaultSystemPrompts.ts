import codexDefaultSystemPrompt from "../../prompts/codex-prompt.txt?raw";
import opencodeDefaultSystemPrompt from "../../prompts/opencode-prompt.txt?raw";
import type { CreateTaskRunner } from "./repositorySelection";

export function getDefaultSystemPrompt(task: CreateTaskRunner): string {
  if (task === "codex") {
    return codexDefaultSystemPrompt.trim();
  }

  if (task === "opencode") {
    return opencodeDefaultSystemPrompt.trim();
  }

  return "";
}
