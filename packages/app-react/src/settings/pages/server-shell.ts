// The shells a server offers (#584), copied from the Solid window's general/behavior.ts (which
// imports Solid): «Default», then each shell by name — by path when two share a name — and a
// configured shell the server no longer lists.

export type ShellOption = { path: string; name: string; acceptable: boolean }
export type ShellSelectOption = { id: string; value: string; name: string; terminalOnly: boolean }

export function shellOptions(input: { shells: readonly ShellOption[]; current: string | undefined }) {
  const counts = input.shells.reduce(
    (result, shell) => result.set(shell.name, (result.get(shell.name) ?? 0) + 1),
    new Map<string, number>(),
  )
  const options: ShellSelectOption[] = [
    { id: "auto", value: "", name: "", terminalOnly: false },
    ...input.shells.map((shell) => {
      const ambiguous = (counts.get(shell.name) ?? 0) > 1
      return {
        id: shell.path,
        value: ambiguous ? shell.path : shell.name,
        name: ambiguous ? shell.path : shell.name,
        terminalOnly: !shell.acceptable,
      }
    }),
  ]
  const known = (option: ShellSelectOption) => option.value === input.current || option.id === input.current
  if (!input.current || options.some(known)) return options
  return [...options, { id: input.current, value: input.current, name: input.current, terminalOnly: false }]
}
