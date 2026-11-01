// A run's artifacts (#448), ported from the Solid window's buff/workflows/panels.tsx: the final
// text, a file, and the panels a workflow fills as it goes — a table, metric tiles, a chart, a
// board. What to show is the schema's (BuffWorkflowPanels).

import { Badge, Panel, StatGrid, StatTile, Table } from "@buff/ui/react"
import type { BuffWorkflow } from "@opencode/schema/buff-workflow"
import { BuffWorkflowPanels } from "@opencode/schema/buff-workflow-panels"
import { useI18n } from "../i18n/provider"
import { Markdown } from "../session/timeline/markdown/markdown"

type Items = readonly { readonly value: unknown; readonly artifact?: string }[]

export function ArtifactCard(props: { artifact: BuffWorkflow.Artifact; items: Items }) {
  const t = useI18n().buff.t
  const artifact = props.artifact
  const own = props.items.filter((item) => item.artifact === artifact.id)
  return (
    <Panel className="buff-wf-artifact" data-artifact={artifact.id} data-kind={artifact.kind}>
      <header className="buff-wf-head">
        <span className="ui-title ui-title--sm">{artifact.title ?? artifact.id}</span>
        {artifact.primary && (
          <Badge size="sm" tone="info" data-state="primary">
            {t("Main result")}
          </Badge>
        )}
        {(artifact.kind === "file" || artifact.kind === "markdown") && (
          <span className="ui-hint">{t("version {version}", { version: artifact.version })}</span>
        )}
      </header>
      {artifact.description && <p className="ui-note">{artifact.description}</p>}
      <ArtifactBody artifact={artifact} items={own} />
    </Panel>
  )
}

function ArtifactBody(props: { artifact: BuffWorkflow.Artifact; items: Items }) {
  const t = useI18n().buff.t
  const artifact = props.artifact
  // The spec's shape follows the artifact's kind, as the Solid panels read it.
  const spec = <Spec,>() => artifact.spec as Spec
  if (artifact.kind === "markdown")
    return <Markdown className="buff-wf-markdown" text={artifact.content ?? ""} cacheKey={`buff-wf:${artifact.id}:${artifact.version}`} />
  if (artifact.kind === "file") return <code className="ui-code">{artifact.path}</code>
  if (artifact.kind === "table")
    return <ArtifactTable table={BuffWorkflowPanels.table(spec<BuffWorkflowPanels.TableSpec>(), props.items, t)} />
  if (artifact.kind === "metrics")
    return (
      <StatGrid label={artifact.title ?? artifact.id}>
        {BuffWorkflowPanels.metrics(spec<BuffWorkflowPanels.MetricsSpec>(), props.items, t).map((tile) => (
          <StatTile key={tile.label} label={tile.label} value={tile.value} />
        ))}
      </StatGrid>
    )
  if (artifact.kind === "chart")
    return <Chart chart={BuffWorkflowPanels.chart(spec<BuffWorkflowPanels.ChartSpec>(), props.items, t)} />
  return (
    <div className="buff-wf-board">
      {BuffWorkflowPanels.board(spec<BuffWorkflowPanels.BoardSpec>(), props.items, t).map((column) => (
        <Panel inset key={column.name} className="buff-wf-board-column">
          <span className="ui-title ui-title--sm">
            {column.name} · {column.cards.length}
          </span>
          {column.cards.map((card, index) => (
            <Panel key={index} className="buff-wf-board-card">
              <span>{card.title}</span>
              {card.detail.map((line) => (
                <span key={line} className="ui-hint">
                  {line}
                </span>
              ))}
            </Panel>
          ))}
        </Panel>
      ))}
    </div>
  )
}

function ArtifactTable(props: { table: ReturnType<typeof BuffWorkflowPanels.table> }) {
  const t = useI18n().buff.t
  if (!props.table.rows.length) return <span className="ui-hint">{t("No rows yet.")}</span>
  return (
    <Table compact framed>
      <thead>
        <tr>
          {props.table.columns.map((column) => (
            <th key={column}>{column}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {props.table.rows.map((row, index) => (
          <tr key={index}>
            {row.map((cell, column) => (
              <td key={column}>{cell}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </Table>
  )
}

const WIDTH = 560
const HEIGHT = 180
const PAD = 28

/** A simple chart without a library: lines or bars per series, labels along the X axis. */
function Chart(props: { chart: ReturnType<typeof BuffWorkflowPanels.chart> }) {
  const t = useI18n().buff.t
  const chart = props.chart
  const xs = [...new Set(chart.series.flatMap((series) => series.points.map((point) => point.x)))]
  const ys = chart.series.flatMap((series) => series.points.map((point) => point.y))
  if (!ys.length) return <span className="ui-hint">{t("No points yet.")}</span>
  const top = Math.max(1, ...ys)
  const bottom = Math.min(0, ...ys)
  const left = (x: string) => PAD + (xs.indexOf(x) + 0.5) * ((WIDTH - PAD * 2) / Math.max(1, xs.length))
  const height = (y: number) => HEIGHT - PAD - ((y - bottom) / (top - bottom)) * (HEIGHT - PAD * 2)
  const band = (WIDTH - PAD * 2) / Math.max(1, xs.length) / Math.max(1, chart.series.length + 1)
  return (
    <>
      <svg className="buff-wf-chart" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={chart.x}>
        <line x1={PAD} y1={HEIGHT - PAD} x2={WIDTH - PAD} y2={HEIGHT - PAD} className="buff-wf-chart-axis" />
        {chart.series.map((series, index) =>
          chart.type === "bar" ? (
            series.points.map((point) => (
              <rect
                key={`${index}-${point.x}`}
                className="buff-wf-chart-mark"
                data-series={index}
                x={left(point.x) - band * (chart.series.length / 2) + band * index}
                y={height(point.y)}
                width={band}
                height={Math.max(1, HEIGHT - PAD - height(point.y))}
              />
            ))
          ) : (
            <polyline
              key={index}
              className="buff-wf-chart-line"
              data-series={index}
              points={series.points.map((point) => `${left(point.x)},${height(point.y)}`).join(" ")}
            />
          ),
        )}
        {xs.map((x) => (
          <text key={x} className="buff-wf-chart-label" x={left(x)} y={HEIGHT - 8} textAnchor="middle">
            {x}
          </text>
        ))}
        <text className="buff-wf-chart-label" x={PAD} y={14}>
          {top}
        </text>
      </svg>
      <div className="buff-wf-legend">
        <span className="ui-hint">{chart.x}</span>
        {chart.series.map((series, index) => (
          <span key={series.label} className="buff-wf-legend-item" data-series={index}>
            {series.label}
          </span>
        ))}
      </div>
    </>
  )
}
