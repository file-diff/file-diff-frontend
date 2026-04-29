import { SHORTEN_PROMPT_API_URL } from "../config/api";

interface ErrorResponse {
  error: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface PromptTitleResponse {
  title: string;
}

export async function requestPromptTitle(
  prompt: string,
  signal?: AbortSignal
): Promise<PromptTitleResponse> {
  const response = await fetch(SHORTEN_PROMPT_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ prompt }),
    signal,
  });

  if (!response.ok) {
    let message = "Unable to generate branch title";

    try {
      const errorData = (await response.json()) as ErrorResponse;
      if (typeof errorData.error === "string" && errorData.error.trim()) {
        message = errorData.error.trim();
      }
    } catch {
      // Ignore response parsing failures and fall back to the generic message.
    }

    throw new Error(message);
  }

  const data = (await response.json()) as unknown;
  const title = isRecord(data) && typeof data.title === "string"
    ? data.title.trim()
    : "";

  if (!title) {
    throw new Error("Prompt title response did not include a title.");
  }

  return { title };
}
