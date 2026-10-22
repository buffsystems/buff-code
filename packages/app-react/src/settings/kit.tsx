// The pieces every settings page is made of (#584): the sticky page header, a titled section, the
// bordered list and its rows, and the row controls (a switch, a select, a text field) — each on a
// `data-action` wrapper, the hook the e2e specs and the settings search reveal use.

import { Input, Panel, SelectMenu, Switch, type SelectMenuOption } from "@buff/ui/react"
import { useId, type CSSProperties, type ReactNode } from "react"

export function SettingsHeader(props: {
  title: string
  description?: ReactNode
  actions?: ReactNode
  children?: ReactNode
}) {
  return (
    <div className={props.children ? "settings-tab-header settings-tab-header--stacked" : "settings-tab-header"}>
      <div className="settings-tab-header-row">
        <div className="flex flex-col gap-1">
          <h2 className="settings-tab-title">{props.title}</h2>
          {props.description && <span className="settings-tab-description">{props.description}</span>}
        </div>
        {props.actions}
      </div>
      {props.children}
    </div>
  )
}

export function SettingsBody(props: { sectioned?: boolean; className?: string; children?: ReactNode }) {
  const classes = ["settings-tab-body", props.sectioned && "settings-tab-body--sectioned", props.className]
  return <div className={classes.filter(Boolean).join(" ")}>{props.children}</div>
}

export function SettingsSection(props: { title?: string; label?: string; className?: string; children?: ReactNode }) {
  return (
    <section className={["settings-section", props.className].filter(Boolean).join(" ")} aria-label={props.label}>
      {props.title && <h3 className="settings-section-title">{props.title}</h3>}
      {props.children}
    </section>
  )
}

export function SettingsList(props: { variant?: "catalog"; children?: ReactNode }) {
  return (
    <Panel data-component="settings-list" data-variant={props.variant}>
      {props.children}
    </Panel>
  )
}

export function SettingsRow(props: { title: ReactNode; description?: ReactNode; children?: ReactNode }) {
  return (
    <div data-component="settings-row">
      <div data-slot="settings-row-copy">
        <div data-slot="settings-row-title">{props.title}</div>
        <div data-slot="settings-row-description">{props.description}</div>
      </div>
      <div data-slot="settings-row-control">{props.children}</div>
    </div>
  )
}

/** A row whose control is a switch; the switch is named by the row's title. */
export function SwitchRow(props: {
  action: string
  title: string
  description?: ReactNode
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <SettingsRow title={props.title} description={props.description}>
      <SettingSwitch
        action={props.action}
        label={props.title}
        checked={props.checked}
        disabled={props.disabled}
        onChange={props.onChange}
      />
    </SettingsRow>
  )
}

export function SettingSwitch(props: {
  action?: string
  label: string
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <div data-action={props.action} className="inline-flex items-center p-1">
      <Switch
        data-slot="switch-control"
        aria-label={props.label}
        checked={props.checked}
        disabled={props.disabled}
        onCheckedChange={props.onChange}
      />
    </div>
  )
}

/** A row whose control is a styled select of a few options. */
export function SelectRow<Value extends string>(props: {
  action: string
  title: string
  description?: ReactNode
  value: Value
  options: readonly { value: Value; label: string; description?: ReactNode }[]
  onChange: (value: Value) => void
  onHighlight?: (value: Value) => void
}) {
  return (
    <SettingsRow title={props.title} description={props.description}>
      <SettingSelect
        action={props.action}
        label={props.title}
        value={props.value}
        options={props.options}
        onChange={props.onChange}
        onHighlight={props.onHighlight}
      />
    </SettingsRow>
  )
}

export function SettingSelect<Value extends string>(props: {
  action?: string
  label: string
  value: Value
  options: readonly { value: Value; label: string; description?: ReactNode }[]
  disabled?: boolean
  onChange: (value: Value) => void
  onHighlight?: (value: Value) => void
}) {
  const options: SelectMenuOption[] = props.options.map((option) => ({ ...option }))
  const pick = (value: string) => props.options.find((option) => option.value === value)?.value
  return (
    <div data-action={props.action}>
      <SelectMenu
        aria-label={props.label}
        value={props.value}
        options={options}
        disabled={props.disabled}
        onValueChange={(value) => {
          const picked = pick(value)
          if (picked !== undefined) props.onChange(picked)
        }}
        onHighlight={(value) => {
          const picked = pick(value)
          if (picked !== undefined) props.onHighlight?.(picked)
        }}
      />
    </div>
  )
}

/** A free-text field that applies as it is typed (fonts). */
export function TextRow(props: {
  action: string
  title: string
  description?: ReactNode
  value: string
  placeholder?: string
  style?: CSSProperties
  onChange: (value: string) => void
}) {
  const id = useId()
  return (
    <SettingsRow title={<label htmlFor={id}>{props.title}</label>} description={props.description}>
      <Input
        id={id}
        className="settings-font-input"
        data-action={props.action}
        type="text"
        value={props.value}
        placeholder={props.placeholder}
        spellCheck={false}
        autoCorrect="off"
        autoComplete="off"
        autoCapitalize="off"
        style={props.style}
        onChange={(event) => props.onChange(event.currentTarget.value)}
      />
    </SettingsRow>
  )
}
