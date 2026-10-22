// "+12 -3" for a file or a set of changes (#584), the Solid DiffChanges.

type Change = { additions: number; deletions: number }

export function sumChanges(changes: Change | readonly Change[]): Change {
  if (!Array.isArray(changes)) return changes as Change
  return (changes as readonly Change[]).reduce(
    (sum, change) => ({
      additions: sum.additions + (change.additions ?? 0),
      deletions: sum.deletions + (change.deletions ?? 0),
    }),
    { additions: 0, deletions: 0 },
  )
}

export function DiffChanges(props: { changes: Change | readonly Change[] }) {
  const total = sumChanges(props.changes)
  if (total.additions + total.deletions === 0) return null
  return (
    <div data-component="diff-changes" data-appearance="compact">
      <span data-slot="diff-changes-additions">{`+${total.additions}`}</span>
      <span data-slot="diff-changes-deletions">{`-${total.deletions}`}</span>
    </div>
  )
}
