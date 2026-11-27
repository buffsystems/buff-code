```chart
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
