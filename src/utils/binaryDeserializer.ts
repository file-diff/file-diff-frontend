import type { FileType, JobFilesResponse } from "./csvParser";

type JobStatus = "waiting" | "active" | "completed" | "failed";

const BYTE_TO_STATUS: Record<number, JobStatus> = {
  0: "waiting",
  1: "active",
  2: "completed",
  3: "failed",
};

/** Convert 4 bytes at the given offset to an 8-character lowercase hex string. */
function bytes4ToHexPrefix(view: DataView, offset: number): string {
  let hex = "";
  for (let i = 0; i < 4; i++) {
    hex += view.getUint8(offset + i).toString(16).padStart(2, "0");
  }
  return hex;
}

/**
 * Deserialize a binary `ArrayBuffer` produced by the engine's
 * `serializeJobFilesResponse` into a {@link JobFilesResponse}.
 *
 * Layout:
 *   2 bytes  – jobId length (uint16 BE)
 *   N bytes  – jobId (UTF-8)
 *   2 bytes  – commit length (uint16 BE)
 *   N bytes  – commit (UTF-8)
 *   2 bytes  – commitShort length (uint16 BE)
 *   N bytes  – commitShort (UTF-8)
 *   1 byte   – status (0=waiting, 1=active, 2=completed, 3=failed)
 *   4 bytes  – progress (float32 BE)
 *   4 bytes  – file count (uint32 BE)
 *   Per-file records:
 *     1 byte  – file type char code
 *     2 bytes – name length (uint16 BE)
 *     N bytes – name (UTF-8)
 *     4 bytes – update timestamp (uint32 BE, unix seconds)
 *     4 bytes – file size (uint32 BE)
 *     4 bytes – commit prefix (first 4 bytes of hex)
 *     4 bytes – hash prefix (first 4 bytes of hex)
 */
export function deserializeJobFilesResponse(
  buffer: ArrayBuffer,
): JobFilesResponse {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const decoder = new TextDecoder();
  let offset = 0;

  // jobId
  const jobIdLen = view.getUint16(offset, false);
  offset += 2;
  const jobId = decoder.decode(bytes.subarray(offset, offset + jobIdLen));
  offset += jobIdLen;

  // commit
  const commitLen = view.getUint16(offset, false);
  offset += 2;
  const commit = decoder.decode(bytes.subarray(offset, offset + commitLen));
  offset += commitLen;

  // commitShort
  const commitShortLen = view.getUint16(offset, false);
  offset += 2;
  const commitShort = decoder.decode(
    bytes.subarray(offset, offset + commitShortLen),
  );
  offset += commitShortLen;

  // status
  const statusByte = view.getUint8(offset);
  offset += 1;
  const status: JobStatus = BYTE_TO_STATUS[statusByte] ?? "waiting";

  // progress
  const progress = view.getFloat32(offset, false);
  offset += 4;

  // file count
  const fileCount = view.getUint32(offset, false);
  offset += 4;

  // files
  const files: NonNullable<JobFilesResponse["files"]> = [];
  for (let i = 0; i < fileCount; i++) {
    const typeByte = view.getUint8(offset);
    offset += 1;

    const nameLen = view.getUint16(offset, false);
    offset += 2;

    const path = decoder.decode(bytes.subarray(offset, offset + nameLen));
    offset += nameLen;

    const updateTs = view.getUint32(offset, false);
    offset += 4;

    const s = view.getUint32(offset, false);
    offset += 4;

    const commitHex = bytes4ToHexPrefix(view, offset);
    offset += 4;

    const hashHex = bytes4ToHexPrefix(view, offset);
    offset += 4;

    files.push({
      t: String.fromCharCode(typeByte) as FileType,
      path,
      s,
      update: new Date(updateTs * 1000).toISOString(),
      commit: commitHex,
      hash: hashHex,
    });
  }

  return { jobId, commit, commitShort, status, progress, files };
}
