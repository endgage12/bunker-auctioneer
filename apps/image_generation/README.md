# Image generation (ComfyUI)

CLI-генератор изображений поверх локального ComfyUI-сервера (http://127.0.0.1:8188).
Скрипт использует только стандартную библиотеку Python 3.10+, без зависимостей.

## Требования

1. Запущенный ComfyUI (ярлык «ComfyUI» в меню Пуск или run_nvidia_gpu.bat в папке ComfyUI).
2. Python 3.10+ (на этой машине: C:/Users/Александр/AppData/Local/Programs/Python/Python310/python.exe).

## Использование

    # показать доступные чекпоинты
    python generate.py --list-models

    # простая генерация (по умолчанию 1024x1024, 20 шагов, euler, cfg 7)
    python generate.py --prompt "a yellow parrot on a branch"

    # полный набор параметров
    python generate.py --prompt "cyberpunk city at night" --width 896 --height 1152 --steps 30 --cfg 6.5

    # несколько вариантов с одним сидом
    python generate.py --prompt "still life with fruit" --count 4 --seed 100

    # иконка предмета: DreamShaper 8 + LoRA для игровых иконок
    python generate.py --model dreamshaper_8.safetensors --lora "RPG-Icons-bf16-pruned-128ND.safetensors:0.85" --prompt "rpgicon, game item icon of a golden sword, handpainted style" --width 512 --height 512

## Параметры

- --server      адрес ComfyUI (по умолчанию http://127.0.0.1:8188)
- --prompt      позитивный промпт (обязателен)
- --negative    негативный промпт (по умолчанию: blurry, low quality, deformed...)
- --model       имя чекпоинта (по умолчанию: первый доступный)
- --lora        LoRA в формате имя:сила (можно несколько раз; по умолчанию сила 0.8)
- --width       ширина (по умолчанию 1024)
- --height      высота (по умолчанию 1024)
- --steps       шаги сэмплинга (по умолчанию 20)
- --cfg         CFG scale (по умолчанию 7.0)
- --sampler     сэмплер (по умолчанию euler; список — в --help)
- --scheduler   планировщик (по умолчанию normal)
- --denoise     сила денойза (по умолчанию 1.0)
- --seed        сид (по умолчанию случайный; при --count > 1 инкрементируется)
- --count       сколько картинок сгенерировать (по умолчанию 1)
- --out         папка для результатов (по умолчанию ./images рядом со скриптом)
- --prefix      префикс имени файла на сервере (по умолчанию gen)
- --timeout     таймаут на одну картинку в секундах (по умолчанию 600)
- --list-models показать чекпоинты и выйти

## Выходные файлы

Картинки сохраняются в папку images/ рядом со скриптом (или в --out).
Каждая строка вывода — JSON с путём к файлу, сидом и временем генерации.

## Иконки каталога игры (catalog_icons.py)

Генерирует иконки 64x64 для всех 62 предметов каталога аукциона (список defId -> английский
промпт задан в самом скрипте). Фиксированный сид + тёмный единый фон, файлы называются
по defId (white-0.png ... red-7.png) — готовы к копированию в apps/web/src/assets/items/.

    D:/ComfyUI/python_embeded/python.exe catalog_icons.py --out images/catalog

Только часть каталога (например, жёлтая категория):

    D:/ComfyUI/python_embeded/python.exe catalog_icons.py --only yellow- --out images/catalog

Параметры: --seed, --lora, --gen-size, --bg-color, --keep-frac, --steps, --only.

## Иконки предметов 64x64 с одинаковым фоном (icons.py)

Скрипт генерирует набор иконок, у которых одинаковый затемнённый фон,
а различается только предмет по центру:

1. Один и тот же сид + шаблон промпта (меняется только название предмета)
   — композиция и фон получаются почти одинаковыми.
2. Пост-нормализация: пиксели за пределами центральной зоны приводятся
   к единому цвету фона (берётся с углов первой иконки).
3. Результат ужимается до 64x64 (LANCZOS).

Запуск (нужен Pillow — есть в python_embeded ComfyUI):

    D:/ComfyUI/python_embeded/python.exe icons.py --items "sword, potion, shield, boots" --seed 4242

Параметры: --template (шаблон промпта с {item}), --lora, --gen-size (по умолчанию 512),
--keep-frac (доля радиуса, где фон не трогаем; по умолчанию 0.55),
--bg-color (целевой цвет фона r,g,b; по умолчанию берётся с первой иконки),
--out (по умолчанию images/icons). В папке также создаётся icons_preview.png — лист-превью.
