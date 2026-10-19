# SPDX-License-Identifier: AGPL-3.0-only
from pathlib import Path
from shutil import copyfile
from PIL import Image
root = Path(__file__).resolve().parents[2]
out = root / 'windows/Zappion.Windows/Assets'
out.mkdir(parents=True, exist_ok=True)
with Image.open(root / 'web/public/images/zappion-logo.png') as source:
    logo = source.convert('RGBA')
    logo.thumbnail((256, 256), Image.Resampling.LANCZOS)
    logo.save(out / 'Logo.png')
    canvas = Image.new('RGBA', (256, 256))
    canvas.alpha_composite(logo, ((256-logo.width)//2, (256-logo.height)//2))
    canvas.save(out / 'AppIcon.ico', sizes=[(n, n) for n in (16, 24, 32, 48, 64, 256)])

copyfile(root / 'web/public/images/chat-wallpaper.png', out / 'Wallpaper.png')
