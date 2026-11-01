// The diff of an edit waiting for permission (#470): the edit tools put the files' diff in the
// request (`metadata.files`) so that «Ask» is decided on the edit itself, not on a file name.

import { permissionDiffs } from "@opencode/app/react-reuse/permission-preview"
import { resolveFileDiff } from "@opencode/session-ui/session-diff"
import type { FileDiffMetadata } from "@pierre/diffs"

export function permissionFileDiffs(metadata: Readonly<Record<string, unknown>> | undefined) {
  return permissionDiffs(metadata).flatMap((diff): { file: string; fileDiff: FileDiffMetadata }[] => {
    try {
      const fileDiff = resolveFileDiff(diff)
      return fileDiff ? [{ file: diff.file, fileDiff }] : []
    } catch {
      return []
    }
  })
}
