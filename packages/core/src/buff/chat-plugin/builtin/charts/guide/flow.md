# Flows and links: sankey, graph, stream, parallel axes

## Sankey

How a quantity splits and merges between stages: budgets, traffic, energy, conversions with branches.

```json
{
  "title": { "text": "Откуда приходят заказы" },
  "series": [{
    "type": "sankey", "left": 8, "right": 110,
    "emphasis": { "focus": "adjacency" },
    "data": [{ "name": "Поиск" }, { "name": "Реклама" }, { "name": "Сайт" }, { "name": "Заказ" }, { "name": "Уход" }],
    "links": [
      { "source": "Поиск", "target": "Сайт", "value": 600 },
      { "source": "Реклама", "target": "Сайт", "value": 400 },
      { "source": "Сайт", "target": "Заказ", "value": 250 },
      { "source": "Сайт", "target": "Уход", "value": 750 }
    ]
  }]
}
```

Every `source` and `target` must be a name in `data`. No cycles: a flow never returns to an earlier node. `"orient": "vertical"` for a top-down flow. Leave `right` room for the last column's labels.

## Graph (network)

Who is linked to whom; a number on the link or the node is secondary.

```json
{
  "title": { "text": "Связи между сервисами" },
  "series": [{
    "type": "graph", "layout": "circular",
    "label": { "show": true, "position": "right" },
    "lineStyle": { "curveness": 0.2 },
    "symbolSize": 18, "edgeSymbol": ["none", "arrow"], "edgeSymbolSize": 7,
    "data": [{ "name": "API" }, { "name": "База" }, { "name": "Очередь" }, { "name": "Воркер" }],
    "links": [
      { "source": "API", "target": "База" }, { "source": "API", "target": "Очередь" },
      { "source": "Очередь", "target": "Воркер" }, { "source": "Воркер", "target": "База" }
    ]
  }]
}
```

- `"layout": "circular"` (the default here) puts the nodes on a ring — the same picture every time. For a large, loosely linked graph use `"layout": "force"` with `"force": {"repulsion": 220, "edgeLength": 90}` and `"roam": true`.
- Groups: `"categories": [{"name": "Сервисы"}, {"name": "Хранилища"}]` and `"category": 0` on each node — the legend then lists the groups.
- Size by importance: `"symbolSize"` on a node. Without direction drop `edgeSymbol`.
- Above ~60 nodes a graph is a hairball: show the top links, or a table.

## Stream (theme river)

How the make-up of a total moves over time, as a flowing band.

```json
{
  "title": { "text": "Обращения по каналам" },
  "singleAxis": { "type": "time", "top": 30, "bottom": 60 },
  "tooltip": { "trigger": "axis" },
  "series": [{ "type": "themeRiver", "label": { "show": false },
    "data": [["2026-01-01", 10, "Сайт"], ["2026-02-01", 14, "Сайт"], ["2026-03-01", 18, "Сайт"],
             ["2026-01-01", 6, "Почта"], ["2026-02-01", 5, "Почта"], ["2026-03-01", 9, "Почта"]] }]
}
```

Every name needs a value at every date. For reading exact values a stacked area (`guide/xy.md`) is better.

## Parallel axes

Many things compared across several measures of different units.

```json
{
  "title": { "text": "Модели по характеристикам" },
  "parallelAxis": [
    { "dim": 0, "name": "Цена" }, { "dim": 1, "name": "Вес, кг" },
    { "dim": 2, "name": "Запас хода, км" }, { "dim": 3, "name": "Класс", "type": "category", "data": ["A", "B", "C"] }
  ],
  "parallel": { "left": 40, "right": 60, "top": 40, "bottom": 30 },
  "series": [{ "type": "parallel", "data": [
    { "name": "Альфа", "value": [1200, 14, 80, "A"] },
    { "name": "Бета", "value": [900, 17, 60, "B"] },
    { "name": "Гамма", "value": [1500, 12, 110, "A"] }
  ] }]
}
```
