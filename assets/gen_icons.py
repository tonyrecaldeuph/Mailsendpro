from PIL import Image, ImageDraw, ImageFilter
import os
import numpy as np

HERE = os.path.dirname(__file__)
SRC = os.path.join(HERE, 'logo_source.png')
OUT_DIR = HERE

NEON = (57, 255, 20, 255)
TRANSPARENT = (0, 0, 0, 0)

# logo_source.png is the original wordmark art with a flat, opaque background
# fill (no alpha). The background is a single uniform color, so it can be
# keyed out precisely: pixels close to it become transparent, pixels far from
# it (the letters, the green checkmark) stay fully opaque. Edge pixels get a
# linear alpha ramp, then their color is decontaminated (unpremultiplied) so
# they don't carry a dark fringe when composited onto a different background.
BG_KEY = (24, 26, 27)
KEY_LOW = 3    # distance <= this: fully transparent (flat background)
KEY_HIGH = 25  # distance >= this: fully opaque (letters/checkmark)


def remove_flat_background(im, bg=BG_KEY, low=KEY_LOW, high=KEY_HIGH):
    arr = np.array(im.convert('RGBA')).astype(np.float32)
    bg_arr = np.array(bg, dtype=np.float32)

    dist = np.sqrt(((arr[..., :3] - bg_arr) ** 2).sum(axis=-1))
    alpha = np.clip((dist - low) / (high - low), 0.0, 1.0)

    a = np.clip(alpha, 1e-3, 1.0)[..., None]
    decontaminated = (arr[..., :3] - bg_arr * (1 - a)) / a
    decontaminated = np.clip(decontaminated, 0, 255)

    edge_mask = (alpha > 0.0) & (alpha < 1.0)
    arr[..., :3] = np.where(edge_mask[..., None], decontaminated, arr[..., :3])
    arr[..., 3] = alpha * 255.0

    return Image.fromarray(arr.astype('uint8'), 'RGBA')


def trim_transparent(im):
    bbox = im.getbbox()
    return im.crop(bbox) if bbox else im


def recolor_dark_to_light(im, light=(255, 255, 255)):
    # The source wordmark renders "PHONE" and the ring outline in near-black,
    # which was invisible against the old opaque near-black card background.
    # Now that the background is transparent, the header drops this logo onto
    # --bg-primary (#0a0a0c) — almost the same near-black — so the letters
    # would vanish again unless recolored. Only the black/gray strokes are
    # remapped to `light`; the green checkmark/accent is left untouched.
    arr = np.array(im.convert('RGBA')).astype(np.float32)
    r, g, b = arr[..., 0], arr[..., 1], arr[..., 2]
    is_green = (g > r + 15) & (g > b + 15)
    light_arr = np.array(light, dtype=np.float32)
    arr[..., :3] = np.where(is_green[..., None], arr[..., :3], light_arr)
    return Image.fromarray(arr.astype('uint8'), 'RGBA')


logo = trim_transparent(remove_flat_background(Image.open(SRC)))

# icon128.png keeps the original dark letters — it's shown on chrome://extensions
# and the Web Store, both light-card contexts where dark-on-light reads fine.
logo_for_icon = logo

# logo_uphone.png is the in-app header logo, dropped onto the dark dashboard
# background — needs light letters to stay legible.
logo_header = recolor_dark_to_light(logo)
logo_header.save(os.path.join(OUT_DIR, 'logo_uphone.png'), 'PNG')
print('logo_uphone.png OK (wordmark, transparent background, light letters for dark header)')

lw, lh = logo_for_icon.size


def make_full_logo(size, padding_ratio=0.06):
    canvas = Image.new('RGBA', (size, size), TRANSPARENT)
    inner = int(size * (1 - 2 * padding_ratio))
    scale = inner / lw
    new_w = inner
    new_h = max(1, int(lh * scale))
    if new_h > inner:
        new_h = inner
        scale = new_h / lh
        new_w = max(1, int(lw * scale))
    resized = logo_for_icon.resize((new_w, new_h), Image.LANCZOS)
    x = (size - new_w) // 2
    y = (size - new_h) // 2
    canvas.paste(resized, (x, y), resized)
    return canvas


def make_check_icon(size):
    scale = 4
    big = size * scale
    canvas = Image.new('RGBA', (big, big), TRANSPARENT)
    draw = ImageDraw.Draw(canvas)
    pad = int(big * 0.18)
    stroke = max(2, int(big * 0.14))
    p1 = (pad, int(big * 0.52))
    p2 = (int(big * 0.42), big - pad - int(big * 0.05))
    p3 = (big - pad, int(big * 0.22))
    draw.line([p1, p2], fill=NEON, width=stroke)
    draw.line([p2, p3], fill=NEON, width=stroke)
    r = stroke // 2
    for p in (p1, p2, p3):
        draw.ellipse([p[0] - r, p[1] - r, p[0] + r, p[1] + r], fill=NEON)
    glow = Image.new('RGBA', (big, big), TRANSPARENT)
    gdraw = ImageDraw.Draw(glow)
    gdraw.line([p1, p2], fill=(57, 255, 20, 180), width=stroke + 6)
    gdraw.line([p2, p3], fill=(57, 255, 20, 180), width=stroke + 6)
    glow = glow.filter(ImageFilter.GaussianBlur(radius=big * 0.04))
    out = Image.new('RGBA', (big, big), TRANSPARENT)
    out = Image.alpha_composite(out, glow)
    out = Image.alpha_composite(out, canvas)
    return out.resize((size, size), Image.LANCZOS)


make_full_logo(128, padding_ratio=0.06).save(os.path.join(OUT_DIR, 'icon128.png'), 'PNG')
print('icon128.png OK (full logo, transparent background)')

make_check_icon(48).save(os.path.join(OUT_DIR, 'icon48.png'), 'PNG')
print('icon48.png OK (check, transparent background)')

make_check_icon(16).save(os.path.join(OUT_DIR, 'icon16.png'), 'PNG')
print('icon16.png OK (check, transparent background)')
