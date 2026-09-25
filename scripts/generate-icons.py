"""Rasterize the beamed note toolbar icon at Firefox's supported sizes."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

root = Path(__file__).resolve().parent.parent / "icons"
scale = 16
for name in ("active", "idle"):
    canvas = Image.new("RGBA", (48 * scale, 48 * scale))
    draw = ImageDraw.Draw(canvas)
    polygon = [(17, 7), (43, 1), (43, 9), (17, 15)]
    draw.polygon([(x * scale, y * scale) for x, y in polygon], fill="white")
    draw.rectangle((17 * scale, 12 * scale, 21 * scale, 40 * scale), fill="white")
    draw.rectangle((39 * scale, 6 * scale, 43 * scale, 34 * scale), fill="white")
    for x, y in ((12, 40), (34, 34)):
        head = Image.new("RGBA", (16 * scale, 10 * scale))
        ImageDraw.Draw(head).ellipse((0, 0, 16 * scale - 1, 10 * scale - 1), fill="white")
        rotated = head.rotate(24, Image.Resampling.BICUBIC, expand=True)
        canvas.alpha_composite(rotated, (round(x * scale - rotated.width / 2),
                                         round(y * scale - rotated.height / 2)))
    # Keep the note large while reserving one pixel for its white outline.
    bounds = canvas.getchannel("A").getbbox()
    if bounds is None:
        raise RuntimeError("The note artwork is empty")
    artwork = canvas.crop(bounds).resize((46 * scale, 43 * scale), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (48 * scale, 48 * scale))
    canvas.alpha_composite(artwork, (scale, round(2.5 * scale)))
    note_mask = canvas.getchannel("A")
    outline_mask = note_mask.filter(ImageFilter.MaxFilter(2 * scale + 1))
    outlined_note = Image.new("RGBA", canvas.size, "#FFFFFF")
    outlined_note.putalpha(outline_mask)
    gray_note = Image.new("RGBA", canvas.size, "#5F6368")
    gray_note.putalpha(note_mask)
    outlined_note.alpha_composite(gray_note)
    for size in (16, 32, 48, 64, 128):
        outlined_note.resize((size, size), Image.Resampling.LANCZOS).save(root / f"{name}-{size}.png")
