import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeIndexingTaskStatus,
  parseIndexingTasksResponse,
} from "../src/utils/indexingTasks.ts";

test("parseIndexingTasksResponse accepts bare task arrays", () => {
  assert.deepEqual(
    parseIndexingTasksResponse([
      {
        id: "task-1",
        repo: "file-diff/example",
        ref: "main",
        status: "completed",
        progress: 100,
        total_files: 12,
        processed_files: 12,
        commit_sha: "abcdef123456",
        created_at: "2026-05-11T10:00:00.000Z",
        updated_at: "2026-05-11T10:01:00.000Z",
      },
    ]),
    [
      {
        id: "task-1",
        repo: "file-diff/example",
        ref: "main",
        status: "completed",
        progress: 100,
        totalFiles: 12,
        processedFiles: 12,
        error: "",
        commit: "abcdef123456",
        commitShort: "abcdef1",
        createdAt: "2026-05-11T10:00:00.000Z",
        updatedAt: "2026-05-11T10:01:00.000Z",
      },
    ]
  );
});

test("parseIndexingTasksResponse accepts wrapped camel-case task payloads", () => {
  assert.deepEqual(
    parseIndexingTasksResponse({
      tasks: [
        {
          jobId: "task-2",
          repository: "file-diff/frontend",
          inputRefName: "feature",
          status: "in_progress",
          totalFiles: 20,
          processedFiles: 5,
          resolvedCommit: "1234567890abcdef",
          commitShort: "1234567",
          createdAt: "2026-05-11T10:00:00.000Z",
          updatedAt: "2026-05-11T10:02:00.000Z",
        },
      ],
    }),
    [
      {
        id: "task-2",
        repo: "file-diff/frontend",
        ref: "feature",
        status: "active",
        progress: undefined,
        totalFiles: 20,
        processedFiles: 5,
        error: "",
        commit: "1234567890abcdef",
        commitShort: "1234567",
        createdAt: "2026-05-11T10:00:00.000Z",
        updatedAt: "2026-05-11T10:02:00.000Z",
      },
    ]
  );
});

test("parseIndexingTasksResponse ignores invalid items and sorts newest first", () => {
  assert.deepEqual(
    parseIndexingTasksResponse({
      items: [
        { repo: "missing/id" },
        {
          id: "older",
          status: "queued",
          updated_at: "2026-05-11T10:00:00.000Z",
        },
        {
          task_id: "newer",
          status: "error",
          updated_at: "2026-05-11T10:03:00.000Z",
        },
      ],
    }).map((task) => [task.id, task.status]),
    [
      ["newer", "failed"],
      ["older", "waiting"],
    ]
  );
});

test("normalizeIndexingTaskStatus handles backend status aliases", () => {
  assert.equal(normalizeIndexingTaskStatus("running"), "active");
  assert.equal(normalizeIndexingTaskStatus("done"), "completed");
  assert.equal(normalizeIndexingTaskStatus("cancelled"), "failed");
  assert.equal(normalizeIndexingTaskStatus("unexpected"), "unknown");
});
