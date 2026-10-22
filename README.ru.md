<p align="center">
  <img src="buff/assets/mark-512.png" alt="Buff" width="96" height="96">
</p>
<h1 align="center">Buff Code</h1>
<p align="center">ИИ-агент для разработки в терминале и на рабочем столе — на своих моделях или на моделях, которые компания даёт через <a href="https://buff.systems">Buff</a>.</p>
<p align="center"><a href="README.md">In English</a></p>

---

## Установка

```bash
curl -fsSL https://buff.systems/install | bash
```

Десктоп для Linux, macOS и Windows, контрольные суммы и подписи каждого выпуска — на
[buff.systems/downloads](https://buff.systems/downloads) и в
[выпусках](https://github.com/buffsystems/buff-code/releases) этого репозитория.

## Что это

- **`buff`** — агент в терминале: читает и правит код, запускает команды, работает с git.
- **Buff Code для рабочего стола** — тот же агент в окне: сессии, изменения, ревью.
- **Свои модели или модели компании.** Подключите любого провайдера, к которому у вас есть ключ
  или подписка, или войдите в Buff и работайте с моделями, инструментами и знаниями своей организации.

Buff Code — форк [opencode](https://github.com/anomalyco/opencode) (MIT). Ядро держим близко к
апстриму, своё строим на его точках расширения.

## Сборка из исходников

Нужен [Bun](https://bun.sh) 1.4.

```bash
bun install
bun dev ~/my-project  # консоль из исходников на каталоге проекта
```

`buff/Makefile` собирает артефакты выпуска (`make -C buff dist`, `make -C buff desktop`) в
контейнере — инструменты одинаковы везде.

## Участие

Issues и pull requests приветствуются — см. [CONTRIBUTING.md](CONTRIBUTING.md). Репозиторий
публикуется снимком на каждый выпуск Buff; принятые изменения выходят в следующем.

## Лицензия

[MIT](LICENSE) — © opencode, © Buff Systems.
