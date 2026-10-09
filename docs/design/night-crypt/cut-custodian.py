"""Regenerate the Night Crypt Custodian crops from the repo's canon sheet.

Usage (from the repo root):
    python night-crypt/cut-custodian.py public/character/00-custodian-canon.png public/character

Needs Pillow, numpy and scipy. Writes custodian-cutout.webp, custodian-portrait.webp
and custodian-lantern.webp next to the canon sheet's crops.
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

src, out_dir = Path(sys.argv[1]), Path(sys.argv[2])
im = Image.open(src).convert("RGB")

# Full figure: remove the parchment ground by flood-filling light, low-saturation
# pixels connected to the image border, then feather the edge.
fig = np.asarray(im.crop((0, 0, 600, 1536))).astype(float) / 255
mx, mn = fig.max(2), fig.min(2)
sat = (mx - mn) / np.maximum(mx, 1e-6)
bg = (mx > 0.33) & (sat < 0.62)
lab, _ = ndimage.label(bg)
edge = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
mask = ndimage.binary_closing(np.isin(lab, list(edge)), iterations=2)
alpha = ndimage.binary_opening(~mask, iterations=2).astype(float)
alpha = ndimage.gaussian_filter(alpha, 1.6)
h = alpha.shape[0]
alpha *= np.clip((h - np.arange(h)) / 120, 0, 1)[:, None]
cut = Image.fromarray((np.dstack([fig, alpha]) * 255).astype("uint8"), "RGBA")
cut = cut.crop(cut.getbbox())
cut = cut.resize((cut.width * 1200 // cut.height, 1200), Image.LANCZOS)
cut.save(out_dir / "custodian-cutout.webp", quality=88)

im.crop((598, 14, 1008, 382)).save(out_dir / "custodian-portrait.webp", quality=90)
im.crop((600, 394, 812, 744)).save(out_dir / "custodian-lantern.webp", quality=90)
print("wrote", out_dir)
