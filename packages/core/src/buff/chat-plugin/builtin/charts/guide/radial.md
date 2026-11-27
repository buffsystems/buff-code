# Radar, polar bars, gauge, progress

## Radar

A profile of one or a few things across 4–8 comparable measures. Every indicator needs its `max`.

```json
{
  "title": { "text": "Сравнение тарифов" },
  "radar": { "indicator": [
    { "name": "Цена", "max": 10 }, { "name": "Скорость", "max": 10 },
    { "name": "Поддержка", "max": 10 }, { "name": "Надёжность", "max": 10 }, { "name": "Функции", "max": 10 }
  ] },
  "series": [{ "type": "radar", "data": [
    { "name": "Базовый", "value": [9, 5, 4, 7, 5] },
    { "name": "Про", "value": [5, 8, 8, 9, 9] }
  ] }]
}
```

Here the legend comes from the `name` of each data item. At most three shapes; more → grouped bars.

## Polar bars

Cyclic categories (hours, months, directions) as bars round a circle:

```json
{
  "title": { "text": "Ветер по направлениям" },
  "polar": { "radius": ["15%", "75%"] },
  "angleAxis": { "type": "category", "data": ["С", "В", "Ю", "З"], "startAngle": 135 },
  "radiusAxis": {},
  "series": [{ "name": "Ветер, дней", "type": "bar", "coordinateSystem": "polar", "data": [12, 30, 9, 21] }]
}
```

`"startAngle"` turns the ring: for compass directions the first one must point up — `90 + 180 / n` for `n` sectors.

## Gauge

One number against a scale with a meaning (load, score, fulfilment).

```json
{
  "title": { "text": "Выполнение плана" },
  "series": [{
    "type": "gauge", "min": 0, "max": 100,
    "progress": { "show": true, "width": 14 },
    "axisLine": { "lineStyle": { "width": 14 } },
    "pointer": { "show": false }, "axisTick": { "show": false }, "splitLine": { "show": false },
    "axisLabel": { "show": false },
    "detail": { "valueAnimation": true, "formatter": "{value} %", "fontSize": 28, "offsetCenter": [0, 0] },
    "data": [{ "value": 72, "name": "План" }]
  }]
}
```

A gauge is a large way to show one number: use it when the scale matters, otherwise say the number.

## Progress ring

The gauge above with `"startAngle": 90, "endAngle": -270` is a full ring. Several goals — several `gauge` series with different `radius` and `center`, or simply horizontal bars to 100 %.
