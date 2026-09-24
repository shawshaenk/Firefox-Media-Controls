"""Rasterize the beamed note toolbar icon at Firefox's supported sizes."""
from pathlib import Path
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parent.parent / "icons"
scale = 16
for name, color in (("active", "#FFFFFF"), ("idle", "#FFFFFF")):
    canvas = Image.new("RGBA", (48 * scale, 48 * scale))
    draw = ImageDraw.Draw(canvas)
    polygon = [(17, 9), (43, 3), (43, 11), (17, 17)]
    draw.polygon([(x * scale, y * scale) for x, y in polygon], fill=color)
    draw.rectangle((17 * scale, 14 * scale, 21 * scale, 36 * scale), fill=color)
    draw.rectangle((39 * scale, 8 * scale, 43 * scale, 30 * scale), fill=color)
    for x, y in ((12, 36), (34, 30)):
        head = Image.new("RGBA", (16 * scale, 10 * scale))
        ImageDraw.Draw(head).ellipse((0, 0, 16 * scale - 1, 10 * scale - 1), fill=color)
        rotated = head.rotate(24, Image.Resampling.BICUBIC, expand=True)
        canvas.alpha_composite(rotated, (round(x * scale - rotated.width / 2),
                                         round(y * scale - rotated.height / 2)))
    taller = canvas.resize((48 * scale, round(48 * scale * 1.14)), Image.Resampling.BICUBIC)
    top = (taller.height - canvas.height) // 2
    canvas = taller.crop((0, top, 48 * scale, top + 48 * scale))
    for size in (16, 32, 48):
        canvas.resize((size, size), Image.Resampling.LANCZOS).save(root / f"{name}-{size}.png")
