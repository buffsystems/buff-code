// How much of a turn the timeline shows (#584), ported from the Solid window's timeline-detail.tsx:
// a scale of five presets and, under «Advanced», the placement and details of each activity.

import "./timeline-detail.css"
import { Collapsible, CollapsibleContent, CollapsibleTrigger, IconButton, Switch, Tooltip } from "@buff/ui/react"
import {
  timelineCategories,
  timelinePreset,
  timelinePresets,
  type TimelineCategory,
  type TimelineDetail,
  type TimelinePlacement,
} from "@opencode/session-ui/timeline/detail"
import { Eye, EyeOff } from "lucide-react"
import { useId, useState, type CSSProperties } from "react"
import { useI18n } from "../../i18n/provider"

const presets = timelinePresets.toReversed()
const detailed = (category: TimelineCategory) => category === "shell" || category === "edit" || category === "thinking"

export function TimelineDetailControl(props: { value: TimelineDetail; onChange: (value: TimelineDetail) => void }) {
  const i18n = useI18n()
  const id = useId()
  const [visible, setVisible] = useState<Partial<Record<TimelineCategory, Exclude<TimelinePlacement, "hidden">>>>({})
  const preset = timelinePreset(props.value)
  const position = preset ? presets.indexOf(preset) : 2
  const label = preset ? i18n.t(`settings.timeline.preset.${preset.id}`) : i18n.t("settings.timeline.custom")
  const activity = (category: TimelineCategory) => i18n.t(`settings.timeline.category.${category}`)
  const update = (category: TimelineCategory, patch: Partial<TimelineDetail[TimelineCategory]>) =>
    props.onChange({ ...props.value, [category]: { ...props.value[category], ...patch } })
  const toggleVisible = (category: TimelineCategory) => {
    const placement = props.value[category].placement
    if (placement !== "hidden") setVisible((current) => ({ ...current, [category]: placement }))
    update(category, { placement: placement === "hidden" ? (visible[category] ?? "grouped") : "hidden" })
  }

  return (
    <div data-component="timeline-detail-control">
      <div data-slot="settings-row-copy">
        <label data-slot="settings-row-title" htmlFor={`${id}-slider`}>
          {i18n.t("settings.timeline.detail")}
        </label>
        <div id={`${id}-description`} data-slot="settings-row-description">
          {i18n.t("settings.timeline.description")}
        </div>
      </div>
      <div data-slot="timeline-detail-scale">
        <div
          data-slot="timeline-detail-track"
          aria-hidden
          style={{ "--timeline-detail-progress": `${(position / (presets.length - 1)) * 100}%` } as CSSProperties}
        >
          {presets.map((item, index) => (
            <span key={item.id} style={{ insetInlineStart: `${(index / (presets.length - 1)) * 100}%` }} />
          ))}
        </div>
        <input
          id={`${id}-slider`}
          data-action="settings-timeline-detail"
          type="range"
          min={0}
          max={presets.length - 1}
          step={1}
          value={position}
          aria-valuetext={label}
          aria-describedby={`${id}-description ${id}-preset-description`}
          onChange={(event) => {
            const next = presets[event.currentTarget.valueAsNumber]
            if (next) props.onChange({ ...next.value })
          }}
        />
      </div>
      <p id={`${id}-preset-description`} aria-live="polite">
        <span data-slot="timeline-detail-summary">{i18n.t("settings.timeline.summary", { preset: label })}</span>{" "}
        {i18n.t(`settings.timeline.description.${preset?.id ?? "custom"}`)}
      </p>
      <Collapsible data-slot="timeline-detail-advanced" defaultOpen={!preset}>
        <CollapsibleTrigger>{i18n.t("settings.timeline.advanced")}</CollapsibleTrigger>
        <CollapsibleContent>
          <div
            data-slot="timeline-detail-categories"
            role="group"
            aria-label={i18n.t("settings.timeline.advanced.description")}
          >
            <div data-slot="timeline-detail-columns">
              <span aria-hidden />
              <span>{i18n.t("settings.timeline.group")}</span>
              <span>{i18n.t("settings.timeline.collapse")}</span>
            </div>
            <div data-slot="timeline-detail-list">
              {timelineCategories.map((category) => {
                const current = props.value[category]
                const hidden = current.placement === "hidden"
                return (
                  <div
                    key={category}
                    data-slot="timeline-detail-category"
                    data-hidden={hidden ? "" : undefined}
                    role="group"
                    aria-labelledby={`${id}-${category}`}
                  >
                    <div data-slot="timeline-detail-activity">
                      <Tooltip
                        content={i18n.t(
                          hidden ? "settings.timeline.visibility.show" : "settings.timeline.visibility.hide",
                        )}
                      >
                        <IconButton
                          id={`${id}-${category}-visibility`}
                          icon={hidden ? EyeOff : Eye}
                          size="xs"
                          data-action="timeline-detail-visibility"
                          aria-label={i18n.t("settings.timeline.visibility.label", { activity: activity(category) })}
                          aria-pressed={!hidden}
                          onClick={() => toggleVisible(category)}
                        />
                      </Tooltip>
                      <label id={`${id}-${category}`} htmlFor={`${id}-${category}-visibility`}>
                        {activity(category)}
                      </label>
                    </div>
                    <div data-slot="timeline-detail-placement">
                      <span data-slot="timeline-detail-field-label" aria-hidden>
                        {i18n.t("settings.timeline.group")}
                      </span>
                      {hidden ? (
                        <span data-slot="timeline-detail-unavailable" aria-hidden />
                      ) : (
                        <span className="contents" data-category={category} data-field="placement">
                          <Switch
                            data-slot="switch-control"
                            aria-label={i18n.t("settings.timeline.grouped.label", { activity: activity(category) })}
                            checked={current.placement === "grouped"}
                            onCheckedChange={(checked) =>
                              update(category, { placement: checked ? "grouped" : "separate" })
                            }
                          />
                        </span>
                      )}
                    </div>
                    <div data-slot="timeline-detail-expansion">
                      {detailed(category) && "details" in current && (
                        <>
                          <span data-slot="timeline-detail-field-label" aria-hidden>
                            {i18n.t("settings.timeline.collapse")}
                          </span>
                          {hidden ? (
                            <span data-slot="timeline-detail-unavailable" aria-hidden />
                          ) : (
                            <span className="contents" data-category={category} data-field="details">
                              <Switch
                                data-slot="switch-control"
                                aria-label={i18n.t("settings.timeline.collapsed.label", { activity: activity(category) })}
                                checked={current.details === "collapsed"}
                                onCheckedChange={(checked) =>
                                  update(category, { details: checked ? "collapsed" : "expanded" })
                                }
                              />
                            </span>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}
