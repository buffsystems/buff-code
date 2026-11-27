# Charts: the `chart` block

The block's content is one JSON object — an Apache ECharts 6 `option`. Strict JSON: double quotes, no comments, no functions, no trailing commas.

## Rules

- Give data, structure and words only. No `color`, `backgroundColor`, fonts or `textStyle`: the app's theme paints the chart, in every theme the user has. Colour single items only where colour is the meaning — and then with a `visualMap`, not hex values.
- Always: `title.text` in the user's language (short — what the chart shows); a `name` on every series (it is the legend); a `name` on a value axis when the unit is not obvious (`"name": "млн ₽"`).
- Formatters are strings, never functions: `"{value} %"` for axis labels; `"{b}: {c}"`, `"{d}%"` for item labels.
- Legend, tooltip, margins and height are set for you. Add them only to change a default (`"legend": {"show": false}`).
- Numbers are numbers, not strings. Dates are ISO strings on a `"type": "time"` axis.
- Category names longer than a word or two → horizontal bars (`guide/xy.md`); vertical bars whose names do not fit are laid down for you.
- At most 8 series — fold the rest into «Другое»/"Other". About 30 categories on an axis, 8 slices in a pie; beyond that use sorted horizontal bars or a table.
- One value scale per chart. Two measures of different scale are two charts (two blocks), not a second axis. The one exception: a cumulative-percent line over bars (Pareto, see `guide/xy.md`).
- Optional `"buff"` key beside the option (not ECharts): `"height"` — 160…640 px; `"ask"` — the message offered when the user clicks an item, with `{name}`, `{series}`, `{title}`; `"ask": false` switches that off.

A single number is a sentence, not a chart. Two to four numbers are a sentence or a small table.

## Choosing the form

| What the data has to show | Form | Where |
|---|---|---|
| Change over time, trend | line; area for volume | below; `guide/xy.md` |
| Comparison of categories, ranking | bars; horizontal when names are long | below; `guide/xy.md` |
| Structure of a whole | stacked bars, 100 % bars; pie or donut for 2–8 parts | below; `guide/share.md` |
| Structure with levels | treemap, sunburst | `guide/hierarchy.md` |
| Correlation of two or three measures | scatter, bubble, heatmap | `guide/xy.md` |
| Distribution | boxplot, histogram | `guide/stats.md` |
| KPI against a goal | gauge, progress ring, bullet bar | `guide/radial.md`, `guide/xy.md` |
| Stages, conversion | funnel | `guide/share.md` |
| Flows and links between things | sankey, graph | `guide/flow.md` |
| Profile across several axes | radar | `guide/radial.md` |
| Prices: open, high, low, close | candlestick | `guide/stats.md` |
| Activity by day | calendar heatmap | `guide/stats.md` |
| A tree of things | tree | `guide/hierarchy.md` |
| A plan in time: tasks, stages, deadlines | Gantt | `guide/forms.md` |
| What sets share | Venn (2–3 sets) | `guide/forms.md` |
| What a text is about | word cloud | `guide/forms.md` |

Read the reference for a form before the first block of that form in a conversation. Line, bar and pie below need none.

## Line

```chart
{
  "title": { "text": "Выручка по месяцам" },
  "xAxis": { "type": "category", "data": ["Янв", "Фев", "Мар", "Апр"] },
  "yAxis": { "type": "value", "name": "млн ₽" },
  "series": [
    { "name": "2025", "type": "line", "data": [12.1, 13.4, 15.0, 14.2] },
    { "name": "2026", "type": "line", "data": [14.0, 15.9, 18.3, 19.1] }
  ]
}
```

## Bars

```chart
{
  "title": { "text": "Заявки по каналам" },
  "xAxis": { "type": "category", "data": ["Сайт", "Почта", "Телефон"] },
  "yAxis": { "type": "value" },
  "series": [{ "name": "Заявки", "type": "bar", "data": [420, 180, 95] }]
}
```

Several series stand side by side; `"stack": "total"` on each stacks them.

## Pie or donut

```chart
{
  "title": { "text": "Доли рынка" },
  "series": [
    {
      "name": "Доля",
      "type": "pie",
      "radius": ["45%", "70%"],
      "data": [
        { "name": "Альфа", "value": 48 },
        { "name": "Бета", "value": 31 },
        { "name": "Другое", "value": 21 }
      ]
    }
  ]
}
```

`"radius": "65%"` is a plain pie. Sort the slices from large to small; «Другое» goes last. Leave the labels to the chart: on a wide screen each slice is named beside it, on a phone the legend carries the names and the shares. More than eight slices are folded into «Другое» for you.
