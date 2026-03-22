import type { FileType, JobFilesResponse } from "./csvParser";

type JobStatus = "waiting" | "active" | "completed" | "failed";

const BYTE_TO_STATUS: Record<number, JobStatus> = {
  0: "waiting",
  1: "active",
  2: "completed",
  3: "failed",
};

const NUMERIC_FILE_TYPE_ORDER: FileType[] = ["d", "t", "b", "x", "s"];
const VALID_FILE_TYPE_SET = new Set<FileType>(NUMERIC_FILE_TYPE_ORDER);

/** Convert 4 bytes at the given offset to an 8-character lowercase hex string. */
function bytes4ToHexPrefix(view: DataView, offset: number): string {
  let hex = "";
  for (let i = 0; i < 4; i++) {
    hex += view.getUint8(offset + i).toString(16).padStart(2, "0");
  }
  return hex;
}

function decodeFileTypeByte(typeByte: number, context: string): FileType {
  const asciiType = String.fromCharCode(typeByte) as FileType;
  if (VALID_FILE_TYPE_SET.has(asciiType)) {
    return asciiType;
  }

  if (typeByte >= 0 && typeByte < NUMERIC_FILE_TYPE_ORDER.length) {
    return NUMERIC_FILE_TYPE_ORDER[typeByte];
  }

  throw new Error(
    `Invalid binary file response: unsupported file type byte ${typeByte} while reading ${context}.`
  );
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
 *     1 byte  – file type code (ASCII char code or numeric enum index)
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

  const createTruncatedResponseError = (context: string): Error =>
    new Error(`Invalid binary file response: truncated while reading ${context}.`);

  const ensureAvailable = (size: number, context: string): void => {
    if (offset + size > view.byteLength) {
      throw createTruncatedResponseError(context);
    }
  };

  const readUint8 = (context: string): number => {
    ensureAvailable(1, context);
    const value = view.getUint8(offset);
    offset += 1;
    return value;
  };

  const readUint16 = (context: string): number => {
    ensureAvailable(2, context);
    const value = view.getUint16(offset, false);
    offset += 2;
    return value;
  };

  const readUint32 = (context: string): number => {
    ensureAvailable(4, context);
    const value = view.getUint32(offset, false);
    offset += 4;
    return value;
  };

  const readFloat32 = (context: string): number => {
    ensureAvailable(4, context);
    const value = view.getFloat32(offset, false);
    offset += 4;
    return value;
  };

  const readString = (size: number, context: string): string => {
    ensureAvailable(size, context);
    const value = decoder.decode(bytes.subarray(offset, offset + size));
    offset += size;
    return value;
  };

  const readHexPrefix = (context: string): string => {
    ensureAvailable(4, context);
    const value = bytes4ToHexPrefix(view, offset);
    offset += 4;
    return value;
  };

  // jobId
  const jobIdLen = readUint16("job id length");
  const jobId = readString(jobIdLen, "job id");

  // commit
  const commitLen = readUint16("commit length");
  const commit = readString(commitLen, "commit");

  // commitShort
  const commitShortLen = readUint16("short commit length");
  const commitShort = readString(commitShortLen, "short commit");

  // status
  const statusByte = readUint8("status");
  const status: JobStatus = BYTE_TO_STATUS[statusByte] ?? "waiting";

  // progress
  const progress = readFloat32("progress");

  // file count
  const fileCount = readUint32("file count");

  // files
  const files: NonNullable<JobFilesResponse["files"]> = [];
  for (let i = 0; i < fileCount; i++) {
    const fileLabel = `file ${i + 1}`;
    const typeByte = readUint8(`${fileLabel} type`);

    const nameLen = readUint16(`${fileLabel} path length`);

    const path = readString(nameLen, `${fileLabel} path`);

    const updateTs = readUint32(`${fileLabel} update timestamp`);

    const s = readUint32(`${fileLabel} size`);

    const commitHex = readHexPrefix(`${fileLabel} commit prefix`);

    const hashHex = readHexPrefix(`${fileLabel} hash prefix`);

    files.push({
      t: decodeFileTypeByte(typeByte, `${fileLabel} type`),
      path,
      s,
      update: new Date(updateTs * 1000).toISOString(),
      commit: commitHex,
      hash: hashHex,
    });
  }

  if (offset !== view.byteLength) {
    throw new Error(
      "Invalid binary file response: unexpected trailing bytes after job files payload."
    );
  }

  return { jobId, commit, commitShort, status, progress, files };
}
