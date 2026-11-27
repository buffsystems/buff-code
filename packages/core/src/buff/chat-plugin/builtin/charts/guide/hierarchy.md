# Hierarchies: treemap, sunburst, tree

All three take nested data: `{ "name": …, "value": …, "children": [ … ] }`. A parent's value is the sum of its children — give it or leave it out, never contradict it.

## Treemap

Shares of a whole with one or two levels; area is the value.

```json
{
  "title": { "text": "Расходы по статьям" },
  "series": [{
    "name": "Расходы", "type": "treemap", "roam": false, "nodeClick": false,
    "breadcrumb": { "show": false },
    "label": { "formatter": "{b}\n{c}" },
    "upperLabel": { "show": true, "height": 22 },
    "levels": [{ "itemStyle": { "gapWidth": 3 } }, { "itemStyle": { "gapWidth": 1 } }],
    "data": [
      { "name": "Люди", "children": [{ "name": "Зарплата", "value": 620 }, { "name": "Обучение", "value": 40 }] },
      { "name": "Офис", "children": [{ "name": "Аренда", "value": 180 }, { "name": "Связь", "value": 25 }] },
      { "name": "Маркетинг", "children": [{ "name": "Реклама", "value": 150 }, { "name": "События", "value": 45 }] }
    ]
  }]
}
```

For drill-down into deep data set `"nodeClick": "zoomToNode"`, `"leafDepth": 1` and `"breadcrumb": {"show": true}`.

## Sunburst

The same data as rings — levels read from the centre out. For 2–3 levels where the path matters.

```json
{
  "title": { "text": "Продажи по странам и городам" },
  "series": [{
    "type": "sunburst", "radius": ["15%", "90%"], "sort": null,
    "label": { "rotate": "radial", "minAngle": 8 },
    "data": [
      { "name": "Россия", "children": [{ "name": "Москва", "value": 40 }, { "name": "Казань", "value": 15 }] },
      { "name": "Казахстан", "children": [{ "name": "Алматы", "value": 12 }] }
    ]
  }]
}
```

## Tree

Structure, not numbers: an org chart, a breakdown, a file tree.

```json
{
  "title": { "text": "Структура компании" },
  "series": [{
    "type": "tree", "orient": "LR", "top": 16, "bottom": 16, "left": 80, "right": 140,
    "symbolSize": 8, "expandAndCollapse": true, "initialTreeDepth": 2,
    "label": { "position": "left", "align": "right" },
    "leaves": { "label": { "position": "right", "align": "left" } },
    "data": [{ "name": "Компания", "children": [
      { "name": "Продукт", "children": [{ "name": "Дизайн" }, { "name": "Разработка" }] },
      { "name": "Продажи" }
    ] }]
  }]
}
```

`"orient": "TB"` grows it downward; `"layout": "radial"` makes it a circle. Leave room for labels with `left`/`right`. Over ~40 nodes: set `"initialTreeDepth": 1`.
