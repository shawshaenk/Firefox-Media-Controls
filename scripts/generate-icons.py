"""Rasterize the beamed note toolbar icon at Firefox's supported sizes."""
from pathlib import Path
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parent.parent / "icons"
scale = 16
for name, color in (("active", "#FFFFFF"), ("idle", "#FFFFFF")):
    canvas = Image.new("RGBA", (48 * scale, 48 * scale))
    draw = ImageDraw.Draw(canvas)
    polygon = [(17, 7), (43, 1), (43, 9), (17, 15)]
    draw.polygon([(x * scale, y * scale) for x, y in polygon], fill=color)
    draw.rectangle((17 * scale, 12 * scale, 21 * scale, 40 * scale), fill=color)
    draw.rectangle((39 * scale, 6 * scale, 43 * scale, 34 * scale), fill=color)
    for x, y in ((12, 40), (34, 34)):
        head = Image.new("RGBA", (16 * scale, 10 * scale))
        ImageDraw.Draw(head).ellipse((0, 0, 16 * scale - 1, 10 * scale - 1), fill=color)
        rotated = head.rotate(24, Image.Resampling.BICUBIC, expand=True)
        canvas.alpha_composite(rotated, (round(x * scale - rotated.width / 2),
                                         round(y * scale - rotated.height / 2)))
    # Leave a little canvas margin, then enlarge the drawing by 25% in each
    # direction. The width slightly exceeds the square canvas and is clipped
    # by one source pixel per side, keeping the toolbar icon close to full size.
    bounds = canvas.getchannel("A").getbbox()
    if bounds is None:
        raise RuntimeError("The note artwork is empty")
    artwork = canvas.crop(bounds).resize((50 * scale, 45 * scale), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (48 * scale, 48 * scale))
    canvas.alpha_composite(artwork, (-1 * scale, round(1.5 * scale)))
    for size in (16, 32, 48):
        canvas.resize((size, size), Image.Resampling.LANCZOS).save(root / f"{name}-{size}.png")
