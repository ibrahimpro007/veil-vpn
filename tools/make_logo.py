#!/usr/bin/env python3
"""VeilVPN brand mark generator.

One master mark — a white shield with a gradient "V" cut into it, on a
dark tile (app icon variant) or transparent (site variant) — exported to
every size the site and client need. Drawn at 4x and downscaled for
smooth edges. Run: python3 tools/make_logo.py
"""
from PIL import Image, ImageDraw, ImageFont
import math
import os

SS = 4  # supersample factor
EMERALD = (52, 211, 153)
CYAN = (6, 182, 212)
DARK = (5, 10, 20)
WHITE = (255, 255, 255)


def gradient(size, c1=EMERALD, c2=CYAN):
    """Diagonal linear gradient image."""
    w, h = size
    base = Image.new("RGB", (w, h))
    px = base.load()
    for y in range(h):
        for x in range(0, w, 8):  # step for speed; smooth enough at 4x
            t = (x + y) / (w + h)
            r = int(c1[0] + (c2[0] - c1[0]) * t)
            g = int(c1[1] + (c2[1] - c1[1]) * t)
            b = int(c1[2] + (c2[2] - c1[2]) * t)
            for dx in range(8):
                if x + dx < w:
                    px[x + dx, y] = (r, g, b)
    return base


def shield_points(cx, cy, w, h):
    """Classic shield outline: flat-ish top with a dip, curved sides to a
    bottom point. Returns polygon points."""
    pts = []
    top = cy - h / 2
    # top edge: from left-top across with slight center dip, via two curves
    for i in range(21):  # left shoulder curve to center dip
        t = i / 20
        x = cx - w / 2 + (w / 2) * t
        y = top + math.sin(t * math.pi) * h * 0.045
        pts.append((x, y))
    for i in range(1, 21):  # center dip to right shoulder
        t = i / 20
        x = cx + (w / 2) * t
        y = top + h * 0.045 - math.sin(t * math.pi) * h * 0.045 + (h * 0.045) * t * 0
        pts.append((x, top + h * 0.045 * (1 - math.sin((1 - t) * math.pi)) * 0 + (top - top)))
    # rebuild right top cleanly: mirror of left side
    pts = pts[:21]
    for i in range(1, 21):
        t = i / 20
        x = cx + (w / 2) * t
        y = top + math.sin((1 - t) * math.pi) * h * 0.045
        pts.append((x, y))
    # right side down to bottom point (bezier-ish via cosine ease)
    for i in range(1, 31):
        t = i / 30
        x = cx + w / 2 - (w / 2) * (1 - math.cos(t * math.pi / 2)) * 0.92
        y = top + (h * 0.98) * (t ** 0.9)
        pts.append((x, min(y, cy + h / 2 - (h * 0.5) * 0)))
    # bottom point and left side back up
    pts.append((cx, cy + h / 2))
    for i in range(29, 0, -1):
        t = i / 30
        x = cx - w / 2 + (w / 2) * (1 - math.cos(t * math.pi / 2)) * 0.92
        y = top + (h * 0.98) * (t ** 0.9)
        pts.append((x, y))
    return pts


def draw_mark(size, dark_tile=True):
    """The VeilVPN mark at `size`x`size` (RGBA)."""
    S = size * SS
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if dark_tile:
        # full-bleed dark rounded tile
        r = int(S * 0.22)
        d.rounded_rectangle([0, 0, S - 1, S - 1], radius=r, fill=DARK + (255,))
    # shield (white) centered, ~62% of tile
    cx, cy = S / 2, S / 2
    sw, sh = S * 0.58, S * 0.66
    pts = shield_points(cx, cy, sw, sh)
    d.polygon(pts, fill=WHITE + (255,))
    # "V" cut: gradient text clipped to the shield area
    grad = gradient((S, S))
    mask = Image.new("L", (S, S), 0)
    md = ImageDraw.Draw(mask)
    try:
        font = ImageFont.truetype(
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
            int(S * 0.40),
        )
    except OSError:
        font = ImageFont.load_default()
    md.text((cx, cy + S * 0.02), "V", font=font, anchor="mm", fill=255)
    shield_mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(shield_mask).polygon(pts, fill=255)
    from PIL import ImageChops

    v_mask = ImageChops.multiply(mask, shield_mask)
    img.paste(grad, (0, 0), v_mask)
    return img.resize((size, size), Image.LANCZOS)


def save_ico(img, path, sizes=(16, 24, 32, 48, 64, 128, 256)):
    img.save(path, format="ICO", sizes=[(s, s) for s in sizes])


def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    site_public = os.path.join(root, "apps/site/public")
    site_app = os.path.join(root, "apps/site/app")
    client_icons = os.path.join(root, "apps/client/assets/icons")
    client_icon_dir = os.path.join(root, "apps/client/assets/icon")
    for p in (site_public, client_icon_dir):
        os.makedirs(p, exist_ok=True)

    mark_dark = draw_mark(1024, dark_tile=True)
    mark_clear = draw_mark(1024, dark_tile=False)

    # --- master (client app icon source for flutter_launcher_icons) ---
    mark_dark.save(os.path.join(client_icon_dir, "icon.png"))

    # --- site ---
    mark_dark.resize((512, 512), Image.LANCZOS).save(
        os.path.join(site_app, "icon.png")
    )
    mark_dark.resize((180, 180), Image.LANCZOS).save(
        os.path.join(site_app, "apple-icon.png")
    )
    save_ico(mark_dark, os.path.join(site_app, "favicon.ico"))
    mark_clear.save(os.path.join(site_public, "logo.png"))
    mark_dark.resize((256, 256), Image.LANCZOS).save(
        os.path.join(site_public, "logo-256.png")
    )

    # OG image 1200x630: dark bg, mark left, wordmark + tagline right.
    W, H = 1200, 630
    og = Image.new("RGB", (W, H), DARK)
    og.paste(mark_dark.resize((380, 380), Image.LANCZOS), (90, 125), mark_dark.resize((380, 380), Image.LANCZOS))
    d = ImageDraw.Draw(og)
    f_big = ImageFont.truetype(
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 110
    )
    f_sub = ImageFont.truetype(
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 44
    )
    d.text((540, 235), "VeilVPN", font=f_big, fill=WHITE)
    d.text((545, 375), "No-Logs WireGuard VPN", font=f_sub, fill=(148, 197, 255))
    og.save(os.path.join(site_public, "og.png"))

    # --- client tray icons (new mark) ---
    mark_dark.resize((64, 64), Image.LANCZOS).save(
        os.path.join(client_icons, "tray.png")
    )
    save_ico(mark_dark, os.path.join(client_icons, "tray.ico"),
             sizes=(16, 24, 32, 48))
    print("logo assets written")


if __name__ == "__main__":
    main()
