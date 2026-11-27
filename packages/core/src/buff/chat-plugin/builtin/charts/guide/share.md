# Shares of a whole and stages: pie, donut, rose, funnel

## Pie and donut

See the main guide. Rules that keep it readable: 2–8 slices, sorted large to small, «Другое» last, the label `"{b}: {d}%"`. More slices or close values → sorted horizontal bars (`guide/xy.md`).

Half donut (a share against 100 %): `"startAngle": 180, "endAngle": 360, "center": ["50%", "70%"], "radius": ["55%", "85%"]`.

Two rings (inner — groups, outer — their parts): two `pie` series, the inner with `"radius": [0, "35%"]` and `"label": {"position": "inner"}`, the outer with `"radius": ["45%", "65%"]`.

## Rose (Nightingale)

A pie where the radius shows the value: `"roseType": "area"`. For cyclic categories (months, hours) with values of one order.

## Funnel

Stages in order, each not larger than the one before.

```json
{
  "title": { "text": "Воронка продаж" },
  "series": [{
    "name": "Этап", "type": "funnel", "sort": "none", "gap": 2,
    "left": "10%", "width": "80%",
    "label": { "position": "inside", "formatter": "{b}: {c}" },
    "data": [
      { "name": "Визиты", "value": 1000 },
      { "name": "Корзина", "value": 420 },
      { "name": "Оплата", "value": 130 }
    ]
  }]
}
```

`"sort": "none"` keeps your order; `"sort": "ascending"` turns it into a pyramid. Say the conversion between stages in the text beside the chart — the funnel shows volumes, not rates.
