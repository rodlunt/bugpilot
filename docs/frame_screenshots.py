#!/usr/bin/env python3
"""Frame raw screenshots for the README: rounded corners, hairline border,
soft drop shadow, padded canvas, light and dark variants.

One-off tooling, run with:
    uv run --with pillow python3 docs/frame_screenshots.py

Not wired into CI; re-run by hand whenever a screenshot is recaptured.
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

DOCS = Path(__file__).parent / "images"

CANVAS_LIGHT = (246, 248, 250)
CANVAS_DARK = (22, 27, 34)
BORDER_LIGHT = (208, 215, 222)
BORDER_DARK = (48, 54, 61)
SHADOW_COLOUR = (0, 0, 0)

CORNER_RADIUS = 18
PAD_SIDE = 48
PAD_TOP = 48
PAD_BOTTOM = 72
SHADOW_BLUR = 28
SHADOW_OFFSET_Y = 14
SHADOW_OPACITY = 90  # 0-255


def rounded_mask(size: tuple[int, int], radius: int) -> Image.Image:
    mask = Image.new("L", size, 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle([(0, 0), (size[0] - 1, size[1] - 1)], radius=radius, fill=255)
    return mask


def frame(src_path: Path, dest_path: Path, canvas_colour, border_colour) -> None:
    shot = Image.open(src_path).convert("RGB")
    sw, sh = shot.size

    canvas_w = sw + PAD_SIDE * 2
    canvas_h = sh + PAD_TOP + PAD_BOTTOM
    canvas = Image.new("RGBA", (canvas_w, canvas_h), canvas_colour + (255,))

    # Soft shadow: a blurred rounded rectangle the same size as the shot,
    # offset down slightly, sitting under the card.
    shadow_layer = Image.new("RGBA", (canvas_w, canvas_h), (0, 0, 0, 0))
    shadow_shape = Image.new("RGBA", (sw, sh), (0, 0, 0, 0))
    shadow_draw = ImageDraw.Draw(shadow_shape)
    shadow_draw.rounded_rectangle(
        [(0, 0), (sw - 1, sh - 1)], radius=CORNER_RADIUS, fill=SHADOW_COLOUR + (SHADOW_OPACITY,)
    )
    shadow_layer.paste(shadow_shape, (PAD_SIDE, PAD_TOP + SHADOW_OFFSET_Y), shadow_shape)
    shadow_layer = shadow_layer.filter(ImageFilter.GaussianBlur(SHADOW_BLUR))
    canvas = Image.alpha_composite(canvas, shadow_layer)

    # Rounded-corner card with the real screenshot inside.
    card = Image.new("RGBA", (sw, sh), (0, 0, 0, 0))
    card.paste(shot, (0, 0))
    mask = rounded_mask((sw, sh), CORNER_RADIUS)
    canvas.paste(card, (PAD_SIDE, PAD_TOP), mask)

    # Hairline border on top, same rounded rect.
    border_layer = Image.new("RGBA", (canvas_w, canvas_h), (0, 0, 0, 0))
    border_draw = ImageDraw.Draw(border_layer)
    border_draw.rounded_rectangle(
        [(PAD_SIDE, PAD_TOP), (PAD_SIDE + sw - 1, PAD_TOP + sh - 1)],
        radius=CORNER_RADIUS,
        outline=border_colour + (255,),
        width=1,
    )
    canvas = Image.alpha_composite(canvas, border_layer)

    canvas.convert("RGB").save(dest_path, "PNG", optimize=True)
    print(f"wrote {dest_path} ({canvas.width}x{canvas.height})")


SHOTS = [
    ("screenshot-hero.png", "screenshot-hero"),
    ("screenshot-bug-report.png", "screenshot-bug-report"),
    ("screenshot-feature-request.png", "screenshot-feature-request"),
]

# Shots whose CONTENT differs by theme (GitHub pages captured in light and
# dark): each theme's raw gets the matching canvas, from
# <stem>-light-raw.png / <stem>-dark-raw.png.
THEMED_SHOTS = [
    "screenshot-github-issue",
    "screenshot-github-triage",
]

for src_name, stem in SHOTS:
    src = DOCS / src_name
    if not src.exists():
        print(f"skip {stem}: no raw {src_name}")
        continue
    frame(src, DOCS / f"{stem}-light.png", CANVAS_LIGHT, BORDER_LIGHT)
    frame(src, DOCS / f"{stem}-dark.png", CANVAS_DARK, BORDER_DARK)

for stem in THEMED_SHOTS:
    for theme, canvas, border in (
        ("light", CANVAS_LIGHT, BORDER_LIGHT),
        ("dark", CANVAS_DARK, BORDER_DARK),
    ):
        src = DOCS / f"{stem}-{theme}-raw.png"
        if not src.exists():
            print(f"skip {stem}-{theme}: no raw")
            continue
        frame(src, DOCS / f"{stem}-{theme}.png", canvas, border)
