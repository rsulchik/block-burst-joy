# Block Burst Joy

Создай мобильную игру-головоломку в стиле Block Blast (блочная головоломка на сетке).

ОСНОВНАЯ МЕХАНИКА:

- Игровое поле — сетка 8x8 клеток

- Внизу экрана — 3 слота с случайными фигурами (из блоков, как в тетрисе: квадраты 1x1, 2x2, линии 1x3, 1x4, L-образные, T-образные и т.д.)

- Игрок перетаскивает (drag & drop) фигуру из слота на поле

- Фигуру можно разместить только если под ней все клетки свободны — во время перетаскивания подсвечивать зелёным (можно поставить) или красным (нельзя)

- Когда фигура размещена — на её месте появляется тот же цвет

- Когда строка или столбец полностью заполнены — они очищаются с анимацией взрыва/свечения, начисляются очки

- Когда все 3 фигуры из слотов использованы — генерируются новые 3 случайные фигуры

- Игра заканчивается, когда ни одну из 3 фигур невозможно разместить на поле — показать экран Game Over со счётом и кнопкой "Играть снова"

СИСТЕМА ОЧКОВ:

- Очки за размещение блока (1 очко за клетку)

- Бонусные очки за очистку линии/столбца (например 10 очков за линию)

- Комбо-бонус, если очищается несколько линий одновременно

- Сохранять рекорд (best score) в локальном хранилище

ВИЗУАЛ И UX:

- Мобильный формат, вертикальная ориентация, крупные тач-зоны

- Яркая, минималистичная цветовая палитра, разноцветные блоки (6-8 цветов)

- Плавные анимации: появление фигур, размещение, очистка линий, тряска при неудачном размещении

- Текущий счёт и рекорд всегда видны в верхней части экрана

- Лёгкая вибрация/звук при очистке линии (если доступно)

ЭКРАНЫ:

1. Главный экран: логотип игры, кнопка "Играть", лучший результат

2. Игровой экран: поле, слоты с фигурами, счёт

3. Экран Game Over: финальный счёт, рекорд, кнопка рестарта, кнопка "Поделиться результатом"

ТЕХНИЧЕСКИЕ ТРЕБОВАНИЯ:

- Полностью адаптивный дизайн под мобильные экраны разных размеров

- Хранение прогресса и рекорда через localStorage

- Плавные 60fps анимации без задержек на слабых устройствах

- Поддержка touch-жестов (drag & drop через touch events, не только mouse)

Начни с базовой рабочей версии: сетка 8x8, генерация фигур, drag & drop, очистка линий, подсчёт очков и Game Over. Затем я попрошу добавить дополнительные фичи (скины, ежедневные задания, монетизацию).

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/749de997-5288-42d9-b9f3-24231bf43406).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm ci
npm run dev
```

Run the verification checks and production PWA build with:

```sh
npm run typecheck
npm test
npm run build
```

Supabase migrations, verified-run Edge Function deployment, and required auth configuration are documented in [`SUPABASE_SETUP.md`](./SUPABASE_SETUP.md).
