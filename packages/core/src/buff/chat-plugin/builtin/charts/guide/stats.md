# Distributions, prices, calendar

## Boxplot

Each box is `[min, Q1, median, Q3, max]` — compute the five numbers yourself.

```json
{
  "title": { "text": "Время ответа по командам" },
  "xAxis": { "type": "category", "data": ["Альфа", "Бета", "Гамма"] },
  "yAxis": { "type": "value", "name": "мин" },
  "series": [
    { "name": "Время ответа", "type": "boxplot",
      "data": [[2, 5, 8, 14, 30], [1, 3, 4, 7, 12], [4, 9, 15, 22, 41]] },
    { "name": "Выбросы", "type": "scatter", "data": [["Альфа", 55], ["Гамма", 70]] }
  ]
}
```

## Histogram

Bin the values yourself. Bars with almost no gap — `"barCategoryGap": "2%"` on the series — over a category axis of bin labels (`"0–10"`, `"10–20"`).

## Error bars

The value as a `bar` or `line`; the interval as a thin floating bar from low to high (`"barWidth": 2`, the technique of floating bars in `guide/xy.md`).

## Population pyramid

Categories (age groups) on `yAxis`; two `bar` series with the same `"stack"`, the left one given as negative numbers. Say in the title which side is which.

## Candlestick (and volume)

Each candle is `[open, close, low, high]` — this order.

```json
{
  "title": { "text": "Акции ACME" },
  "xAxis": { "type": "category", "data": ["03.11", "04.11", "05.11", "06.11"] },
  "yAxis": { "scale": true, "name": "₽" },
  "dataZoom": [{ "type": "inside" }],
  "series": [{ "name": "ACME", "type": "candlestick",
    "data": [[120, 124, 118, 126], [124, 121, 119, 125], [121, 128, 120, 129], [128, 127, 125, 131]] }]
}
```

Rising and falling candles are coloured by the theme. Volume goes into a second grid under the price:
`"grid": [{"bottom": "34%"}, {"top": "72%"}]`, a second `xAxis`/`yAxis` with `"gridIndex": 1`, and a `bar` series with `"xAxisIndex": 1, "yAxisIndex": 1`.
A moving average is a `line` series over the same categories (compute it yourself).

## Calendar heatmap

A value for every day of a period.

```json
{
  "title": { "text": "Коммиты по дням" },
  "visualMap": { "min": 0, "max": 12, "orient": "horizontal" },
  "calendar": { "range": ["2026-09-01", "2026-11-30"], "top": 28, "left": 36, "cellSize": 18 },
  "series": [{ "name": "Коммиты", "type": "heatmap", "coordinateSystem": "calendar",
    "data": [
      ["2026-09-01", 3], ["2026-09-02", 7], ["2026-09-03", 0], ["2026-09-04", 5], ["2026-09-05", 0],
      ["2026-09-06", 0], ["2026-09-07", 0], ["2026-09-08", 4], ["2026-09-09", 6], ["2026-09-10", 8],
      ["2026-09-11", 1], ["2026-09-12", 0], ["2026-09-13", 0], ["2026-09-14", 5], ["2026-09-15", 7],
      ["2026-09-16", 11], ["2026-09-17", 3], ["2026-09-18", 2], ["2026-09-19", 6], ["2026-09-20", 0],
      ["2026-09-21", 0], ["2026-09-22", 4], ["2026-09-23", 9], ["2026-09-24", 12], ["2026-09-25", 5],
      ["2026-09-26", 0], ["2026-09-27", 0], ["2026-09-28", 0], ["2026-09-29", 2], ["2026-09-30", 6],
      ["2026-10-01", 3], ["2026-10-02", 7], ["2026-10-03", 0], ["2026-10-04", 5], ["2026-10-05", 9],
      ["2026-10-06", 2], ["2026-10-07", 0], ["2026-10-08", 4], ["2026-10-09", 6], ["2026-10-10", 8],
      ["2026-10-11", 0], ["2026-10-12", 0], ["2026-10-13", 0], ["2026-10-14", 5], ["2026-10-15", 7],
      ["2026-10-16", 11], ["2026-10-17", 0], ["2026-10-18", 0], ["2026-10-19", 6], ["2026-10-20", 0],
      ["2026-10-21", 0], ["2026-10-22", 4], ["2026-10-23", 9], ["2026-10-24", 0], ["2026-10-25", 5],
      ["2026-10-26", 3], ["2026-10-27", 1], ["2026-10-28", 0], ["2026-10-29", 2], ["2026-10-30", 6],
      ["2026-10-31", 3], ["2026-11-01", 0], ["2026-11-02", 0], ["2026-11-03", 5], ["2026-11-04", 9],
      ["2026-11-05", 2], ["2026-11-06", 0], ["2026-11-07", 0], ["2026-11-08", 0], ["2026-11-09", 8],
      ["2026-11-10", 1], ["2026-11-11", 0], ["2026-11-12", 0], ["2026-11-13", 5], ["2026-11-14", 0],
      ["2026-11-15", 11], ["2026-11-16", 3], ["2026-11-17", 2], ["2026-11-18", 6], ["2026-11-19", 0],
      ["2026-11-20", 0], ["2026-11-21", 4], ["2026-11-22", 0], ["2026-11-23", 12], ["2026-11-24", 5],
      ["2026-11-25", 3], ["2026-11-26", 1], ["2026-11-27", 0], ["2026-11-28", 0], ["2026-11-29", 0],
      ["2026-11-30", 3]
    ] }],
  "buff": { "height": 230 }
}
```

A whole year: `"range": "2026"`. Give a value for every day you know — days left out stay blank, and a calendar of a few cells says nothing.
