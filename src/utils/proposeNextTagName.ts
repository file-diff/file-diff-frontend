/**
 * Propose a name for a new tag based on the most recently created tag.
 *
 * Behavior:
 * - If the previous tag ends with a numeric suffix (e.g. `v0.2.4-test-6`),
 *   the suffix is incremented by one (`v0.2.4-test-7`).
 * - If the numeric suffix is zero-padded (e.g. `v0.2.4-test-06`), the same
 *   width is preserved when incrementing (`v0.2.4-test-07`).
 * - If the previous tag does not end with a numeric suffix, the previous tag
 *   name is returned unchanged so the user can edit it.
 * - If there is no previous tag, an empty string is returned.
 */
export function proposeNextTagName(lastTag: string | null | undefined): string {
  if (!lastTag) {
    return "";
  }

  const match = /^(.*?)(\d+)$/.exec(lastTag);
  if (!match) {
    return lastTag;
  }

  const [, prefix, digits] = match;
  const next = (BigInt(digits) + 1n).toString();
  const padded = next.length < digits.length
    ? next.padStart(digits.length, "0")
    : next;
  return `${prefix}${padded}`;
}
