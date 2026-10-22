import { For, Match, Show, Switch } from "solid-js"
import type { BuffWorkflow } from "@opencode/schema/buff-workflow"
import { BuffWorkflowPanels } from "@opencode/schema/buff-workflow-panels"
import { Button } from "@opencode/ui/button"
import { Markdown } from "@opencode/session-ui/markdown"
import { useBuffText } from "../i18n"

/**
 * Артефакты прогона (#448): итоговый текст, файл, и панели, которые сценарий наполняет по ходу —
 * таблица, плитки метрик, график, доска. Что показать, считает схема (`BuffWorkflowPanels`).
 */

type Items = readonly { readonly value: unknown; readonly artifact?: string }[]

export function ArtifactCard(props: {
  artifact: BuffWorkflow.Artifact
  items: Items
  onOpenFile?: (path: string) => void
}) {
  const own = () => props.items.filter((item) => item.artifact === props.artifact.id)
  const spec = <T,>() => props.artifact.spec as T
  const { t } = useBuffText()
  return (
    <section class="buff-wf-artifact" data-artifact={props.artifact.id} data-kind={props.artifact.kind}>
      <header class="buff-wf-artifact-head">
        <span class="buff-wf-artifact-title">{props.artifact.title ?? props.artifact.id}</span>
        <Show when={props.artifact.primary}>
          <span class="buff-wf-badge" data-state="primary">
            {t("Main result")}
          </span>
        </Show>
        <Show when={props.artifact.kind === "file" || props.artifact.kind === "markdown"}>
          <span class="buff-wf-weak">{t("version {version}", { version: props.artifact.version })}</span>
        </Show>
      </header>
      <Show when={props.artifact.description}>
        <p class="buff-wf-weak">{props.artifact.description}</p>
      </Show>
      <Switch>
        <Match when={props.artifact.kind === "markdown"}>
          <Markdown class="buff-wf-markdown" text={props.artifact.content ?? ""} />
        </Match>
        <Match when={props.artifact.kind === "file"}>
          <div class="buff-wf-file">
            <code>{props.artifact.path}</code>
            <Show when={props.onOpenFile && props.artifact.path}>
              {(path) => (
                <Button size="small" variant="neutral" onClick={() => props.onOpenFile?.(path())}>
                  {t("Open")}
                </Button>
              )}
            </Show>
          </div>
        </Match>
        <Match when={props.artifact.kind === "table"}>
          <Table table={BuffWorkflowPanels.table(spec<BuffWorkflowPanels.TableSpec>(), own(), t)} />
        </Match>
        <Match when={props.artifact.kind === "metrics"}>
          <div class="buff-wf-tiles">
            <For each={BuffWorkflowPanels.metrics(spec<BuffWorkflowPanels.MetricsSpec>(), own(), t)}>
              {(tile) => (
                <div class="buff-wf-tile">
                  <span class="buff-wf-tile-value">{tile.value}</span>
                  <span class="buff-wf-weak">{tile.label}</span>
                </div>
              )}
            </For>
          </div>
        </Match>
        <Match when={props.artifact.kind === "chart"}>
          <Chart chart={BuffWorkflowPanels.chart(spec<BuffWorkflowPanels.ChartSpec>(), own(), t)} />
        </Match>
        <Match when={props.artifact.kind === "board"}>
          <div class="buff-wf-board">
            <For each={BuffWorkflowPanels.board(spec<BuffWorkflowPanels.BoardSpec>(), own(), t)}>
              {(column) => (
                <div class="buff-wf-board-column">
                  <span class="buff-wf-board-name">
                    {column.name} · {column.cards.length}
                  </span>
                  <For each={column.cards}>
                    {(card) => (
                      <div class="buff-wf-board-card">
                        <span>{card.title}</span>
                        <For each={card.detail}>{(line) => <span class="buff-wf-weak">{line}</span>}</For>
                      </div>
                    )}
                  </For>
                </div>
              )}
            </For>
          </div>
        </Match>
      </Switch>
    </section>
  )
}

function Table(props: { table: ReturnType<typeof BuffWorkflowPanels.table> }) {
  const { t } = useBuffText()
  return (
    <Show when={props.table.rows.length} fallback={<span class="buff-wf-weak">{t("No rows yet.")}</span>}>
      <div class="buff-wf-table-wrap">
        <table class="buff-wf-table">
          <thead>
            <tr>
              <For each={props.table.columns}>{(column) => <th>{column}</th>}</For>
            </tr>
          </thead>
          <tbody>
            <For each={props.table.rows}>
              {(row) => (
                <tr>
                  <For each={row}>{(cell) => <td>{cell}</td>}</For>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </div>
    </Show>
  )
}

const WIDTH = 560
const HEIGHT = 180
const PAD = 28

/** Простой график без библиотек: линии или столбики по сериям, подписи по оси X. */
function Chart(props: { chart: ReturnType<typeof BuffWorkflowPanels.chart> }) {
  const xs = () => [...new Set(props.chart.series.flatMap((series) => series.points.map((point) => point.x)))]
  const ys = () => props.chart.series.flatMap((series) => series.points.map((point) => point.y))
  const top = () => Math.max(1, ...ys())
  const bottom = () => Math.min(0, ...ys())
  const left = (x: string) => PAD + (xs().indexOf(x) + 0.5) * ((WIDTH - PAD * 2) / Math.max(1, xs().length))
  const height = (y: number) => HEIGHT - PAD - ((y - bottom()) / (top() - bottom())) * (HEIGHT - PAD * 2)
  const { t } = useBuffText()
  const band = () => (WIDTH - PAD * 2) / Math.max(1, xs().length) / Math.max(1, props.chart.series.length + 1)
  return (
    <Show when={ys().length} fallback={<span class="buff-wf-weak">{t("No points yet.")}</span>}>
      <svg class="buff-wf-chart" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={props.chart.x}>
        <line x1={PAD} y1={HEIGHT - PAD} x2={WIDTH - PAD} y2={HEIGHT - PAD} class="buff-wf-chart-axis" />
        <For each={props.chart.series}>
          {(series, index) =>
            props.chart.type === "bar" ? (
              <For each={series.points}>
                {(point) => (
                  <rect
                    class="buff-wf-chart-mark"
                    data-series={index()}
                    x={left(point.x) - band() * (props.chart.series.length / 2) + band() * index()}
                    y={height(point.y)}
                    width={band()}
                    height={Math.max(1, HEIGHT - PAD - height(point.y))}
                  />
                )}
              </For>
            ) : (
              <polyline
                class="buff-wf-chart-line"
                data-series={index()}
                points={series.points.map((point) => `${left(point.x)},${height(point.y)}`).join(" ")}
              />
            )
          }
        </For>
        <For each={xs()}>
          {(x) => (
            <text class="buff-wf-chart-label" x={left(x)} y={HEIGHT - 8} text-anchor="middle">
              {x}
            </text>
          )}
        </For>
        <text class="buff-wf-chart-label" x={PAD} y={14}>
          {top()}
        </text>
      </svg>
      <div class="buff-wf-legend">
        <span class="buff-wf-weak">{props.chart.x}</span>
        <For each={props.chart.series}>
          {(series, index) => (
            <span class="buff-wf-legend-item" data-series={index()}>
              {series.label}
            </span>
          )}
        </For>
      </div>
    </Show>
  )
}
