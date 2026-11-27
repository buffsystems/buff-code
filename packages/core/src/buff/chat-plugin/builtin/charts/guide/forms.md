# Forms that are not an ECharts option: Gantt, Venn, word cloud

These three are drawn by the plugin itself. The block is still one JSON object in a `chart` block, but instead of `series` it gives plain data and names the form in `"buff": { "form": … }`. `title.text`, `buff.height` and `buff.ask` work as everywhere; nothing else of an ECharts option is read.

## Gantt — a plan in time

`tasks` in the order they should stand. Each: `name`, `start` and `end` as ISO dates; optional `group` (a stream or a team — it colours the task and makes the legend; at most 8) and `done`, 0–100, the share finished. A task without `end` is a milestone, drawn as a diamond on its date. Up to about 20 tasks.

```chart
{
  "title": { "text": "План запуска" },
  "buff": { "form": "gantt" },
  "tasks": [
    { "name": "Исследование", "start": "2026-03-02", "end": "2026-03-13", "group": "Продукт", "done": 100 },
    { "name": "Дизайн", "start": "2026-03-09", "end": "2026-03-27", "group": "Продукт", "done": 60 },
    { "name": "Разработка", "start": "2026-03-16", "end": "2026-04-24", "group": "Команда", "done": 20 },
    { "name": "Тестирование", "start": "2026-04-20", "end": "2026-05-15", "group": "Команда" },
    { "name": "Релиз", "start": "2026-05-18", "group": "Продукт" }
  ]
}
```

## Venn — what two or three sets share

`sets`: two or three, each `name` and `value` — the whole size of the set. `overlaps`: each `sets` (the names) and `value` — the whole size of what those sets share; with three sets give every pair and the three together. The plugin works out what lies in each region alone and writes it there; the circles are a scheme, not to scale. More than three sets, or sets that do not overlap — use bars.

```chart
{
  "title": { "text": "Навыки кандидатов" },
  "buff": { "form": "venn" },
  "sets": [
    { "name": "Python", "value": 64 },
    { "name": "SQL", "value": 58 },
    { "name": "Английский", "value": 40 }
  ],
  "overlaps": [
    { "sets": ["Python", "SQL"], "value": 30 },
    { "sets": ["Python", "Английский"], "value": 18 },
    { "sets": ["SQL", "Английский"], "value": 14 },
    { "sets": ["Python", "SQL", "Английский"], "value": 9 }
  ]
}
```

## Word cloud — what a text is about

`words`: each `name` and `value` (how often, how weighty); 15–60 words, single words or short phrases, already cleaned of stop words. `buff.measure` names the number («Упоминаний»). A cloud gives an impression, not a comparison: when the user needs to compare, use sorted horizontal bars (`guide/xy.md`).

```chart
{
  "title": { "text": "О чём пишут в отзывах" },
  "buff": { "form": "wordcloud", "measure": "Упоминаний" },
  "words": [
    { "name": "доставка", "value": 96 }, { "name": "цена", "value": 80 }, { "name": "качество", "value": 74 },
    { "name": "поддержка", "value": 61 }, { "name": "упаковка", "value": 48 }, { "name": "скидки", "value": 44 },
    { "name": "приложение", "value": 40 }, { "name": "возврат", "value": 35 }, { "name": "курьер", "value": 33 },
    { "name": "оплата", "value": 30 }, { "name": "ассортимент", "value": 28 }, { "name": "сроки", "value": 26 },
    { "name": "бонусы", "value": 22 }, { "name": "размер", "value": 20 }, { "name": "сайт", "value": 19 },
    { "name": "очередь", "value": 16 }, { "name": "подарок", "value": 14 }, { "name": "гарантия", "value": 13 }
  ]
}
```
