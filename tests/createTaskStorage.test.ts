import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  CREATE_TASK_DRAFT_STORAGE_KEY,
  REPO_CREATE_TASK_DRAFTS_STORAGE_KEY,
  loadCreateTaskDraft,
  loadRepoCreateTaskDraft,
  saveCreateTaskDraft,
  saveRepoCreateTaskDraft,
} from "../src/utils/createTaskStorage.ts";
import type { CreateTaskDraft } from "../src/utils/createTaskStorage.ts";

function installLocalStorage(initialEntries: Record<string, string> = {}) {
  const store = new Map(Object.entries(initialEntries));
  globalThis.localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;

  return store;
}

const draft: CreateTaskDraft = {
  repoInput: "file-diff/file-diff-frontend",
  problemStatement: "Allow branch titles to be edited.",
  systemPrompt: "Use the default prompt.",
  task: "codex",
  model: "gpt-5.5",
  agentId: "",
  customAgent: "",
  branchTitle: "fd-agent/hand-edited-branch-title",
  baseRef: "main",
  pullRequestCompletionMode: "AutoMerge",
  reasoningEffort: "high",
  reasoningSummary: "detailed",
  taskDelayEnabled: false,
  taskDelayMinutes: "",
};

afterEach(() => {
  delete (globalThis as { localStorage?: Storage }).localStorage;
});

test("create task drafts persist manually edited branch titles", () => {
  installLocalStorage();

  saveCreateTaskDraft(draft);

  assert.equal(
    loadCreateTaskDraft()?.branchTitle,
    "fd-agent/hand-edited-branch-title"
  );
});

test("repo create task drafts persist manually edited branch titles", () => {
  installLocalStorage();

  saveRepoCreateTaskDraft("File-Diff/File-Diff-Frontend", {
    ...draft,
    branchTitle: "fd-agent/repo-specific-title",
  });

  assert.equal(
    loadRepoCreateTaskDraft("file-diff/file-diff-frontend")?.branchTitle,
    "fd-agent/repo-specific-title"
  );
});

test("legacy create task drafts default missing branch titles to empty string", () => {
  installLocalStorage({
    [CREATE_TASK_DRAFT_STORAGE_KEY]: JSON.stringify({
      ...draft,
      branchTitle: undefined,
    }),
  });

  assert.equal(loadCreateTaskDraft()?.branchTitle, "");
});

test("legacy repo create task drafts default missing branch titles to empty string", () => {
  installLocalStorage({
    [REPO_CREATE_TASK_DRAFTS_STORAGE_KEY]: JSON.stringify({
      "file-diff/file-diff-frontend": {
        ...draft,
        branchTitle: undefined,
      },
    }),
  });

  assert.equal(
    loadRepoCreateTaskDraft("file-diff/file-diff-frontend")?.branchTitle,
    ""
  );
});
