# XY charts: lines, areas, bars, points, heatmap

Contents: area · stacked and 100 % · horizontal and ranked bars · smooth and step lines · time axis and zoom · bar + line (Pareto) · scatter and bubble · range bars and waterfall · lollipop, dumbbell, bullet · heatmap · marks.

Everything here uses `xAxis` + `yAxis` + `series`. A category axis takes `"data": [...]`; a value axis takes none.

## Area

A line series with `"areaStyle": {}`. For volume or a running total.

## Stacked and 100 %

Give every series the same `"stack": "total"`. Works for `bar` and for `line` + `areaStyle`.
For 100 % compute the percentages yourself, set `"yAxis": {"type": "value", "max": 100, "axisLabel": {"formatter": "{value} %"}}`.

## Horizontal and ranked bars

Swap the axes: `"yAxis": {"type": "category", "data": [...], "inverse": true}`, `"xAxis": {"type": "value"}`. Sort the data from large to small yourself — `inverse` puts the first item on top. Use for long names and for more than about eight categories.

## Smooth and step lines

`"smooth": true` — a soft trend. `"step": "end"` — a value that holds until it changes (tariffs, stock, versions). `"connectNulls": false` with `null` in the data shows a gap.

## Time axis and zoom

```json
{
  "title": { "text": "Визиты по дням" },
  "xAxis": { "type": "time" },
  "yAxis": { "type": "value" },
  "dataZoom": [{ "type": "slider" }, { "type": "inside" }],
  "series": [{ "name": "Визиты", "type": "line", "showSymbol": false,
    "data": [["2026-01-01", 120], ["2026-01-02", 132], ["2026-01-03", 101]] }]
}
```

Use `dataZoom` from about 60 points up. `"showSymbol": false` for dense lines.

## Bars and a cumulative line (Pareto)

The only case for a second axis: counts as bars, cumulative share as a line.

```json
{
  "title": { "text": "Дефекты по причинам" },
  "xAxis": { "type": "category", "data": ["A", "B", "C", "D"] },
  "yAxis": [{ "type": "value", "name": "шт." },
            { "type": "value", "name": "%", "max": 100, "axisLabel": { "formatter": "{value} %" } }],
  "series": [
    { "name": "Дефекты", "type": "bar", "data": [50, 30, 15, 5] },
    { "name": "Накопленная доля", "type": "line", "yAxisIndex": 1, "data": [50, 80, 95, 100] }
  ]
}
```

## Scatter and bubble

Both axes are `"type": "value"`; each point is `[x, y]`. Name the axes.

```json
{
  "title": { "text": "Цена и продажи" },
  "xAxis": { "type": "value", "name": "Цена, ₽", "scale": true },
  "yAxis": { "type": "value", "name": "Продажи, шт.", "scale": true },
  "series": [{ "name": "Товары", "type": "scatter",
    "data": [[120, 340], [90, 510], [200, 150]] }]
}
```

Bubble: points `[x, y, size, "label"]` plus `"symbolSize": 12` replaced by a `visualMap` on the size:
`"visualMap": {"show": false, "dimension": 2, "min": 0, "max": 100, "inRange": {"symbolSize": [8, 40]}}`.
To name points in the tooltip use `"encode": {"tooltip": [0, 1, 2], "itemName": 3}`.

## Range (floating) bars and waterfall

Floating bars: a transparent base series under the visible ones, all with the same `stack`. In a waterfall rises and falls are two named series, so the legend says which is which; where one has a value the other has `"-"`.

```json
{
  "title": { "text": "От выручки к прибыли" },
  "xAxis": { "type": "category", "data": ["Выручка", "Себестоимость", "Расходы", "Прочие доходы", "Прибыль"] },
  "yAxis": { "type": "value", "name": "млн ₽" },
  "tooltip": { "trigger": "item" },
  "series": [
    { "name": "base", "type": "bar", "stack": "w", "silent": true,
      "itemStyle": { "color": "transparent" }, "data": [0, 60, 35, 35, 0] },
    { "name": "Рост и итог", "type": "bar", "stack": "w",
      "label": { "show": true, "position": "top" }, "data": [100, "-", "-", 10, 45] },
    { "name": "Снижение", "type": "bar", "stack": "w",
      "label": { "show": true, "position": "bottom" }, "data": ["-", 40, 25, "-", "-"] }
  ]
}
```

The base is the lower edge of each step: the running total after a fall, before a rise. The transparent base is the one permitted use of an item colour; it is kept out of the legend and the table for you.

## Lollipop, dumbbell, bullet

- Lollipop (a ranking where position matters, not mass): a `bar` series with `"barWidth": 2` and a `scatter` series over the same data and categories.
- Dumbbell (before and after, or two groups, per category): categories on `yAxis`, two `scatter` series — one per moment — with `"symbolSize": 12`. The reader compares two dots on one row.
- Bullet (fact against a goal): a horizontal `bar` for the fact with `"markLine": {"symbol": "none", "data": [{"xAxis": 120, "name": "Цель"}]}`.

## Heatmap

Two category axes, values as `[xIndex, yIndex, value]`, and a `visualMap` — here colour is the meaning.

```json
{
  "title": { "text": "Обращения по времени" },
  "xAxis": { "type": "category", "data": ["Пн", "Вт", "Ср"] },
  "yAxis": { "type": "category", "data": ["Утро", "День", "Вечер"] },
  "visualMap": { "min": 0, "max": 20, "orient": "horizontal" },
  "series": [{ "name": "Обращения", "type": "heatmap", "label": { "show": true },
    "data": [[0, 0, 5], [1, 0, 12], [2, 0, 3], [0, 1, 18], [1, 1, 9], [2, 1, 7], [0, 2, 2], [1, 2, 6], [2, 2, 14]] }]
}
```

Do not set `inRange.color`: the theme gives the ramp.

## Marks: average, goal, period

On any series: `"markLine": {"data": [{"type": "average", "name": "Среднее"}]}`, `{"yAxis": 100, "name": "План"}`;
`"markPoint": {"data": [{"type": "max"}, {"type": "min"}]}`;
`"markArea": {"data": [[{"xAxis": "Мар"}, {"xAxis": "Май"}]]}` for a period.
