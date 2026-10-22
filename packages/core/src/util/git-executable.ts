import { BuffGitBinary } from "../buff/git-binary.js"

// Buff (#495): системный git, а без него — встроенный в сборку; снимкам — git не старше 2.35.
export const gitExecutable = BuffGitBinary.current().repository

export const snapshotGitExecutable = () => BuffGitBinary.current().snapshot
