"""Pack Poly Haven (CC0) ground textures into the game's format.

python3 tools/textures/pack_polyhaven.py <download_dir> assets/textures

For each material writes:
  <name>_c.jpg  albedo with ambient occlusion multiplied in
  <name>_n.jpg  R,G = OpenGL normal xy, B = roughness
Sources (polyhaven.com, CC0): red_dirt_mud_01, red_laterite_soil_stones, brown_mud_03.
"""
import sys, os
import numpy as np
from PIL import Image

src, dst = sys.argv[1], sys.argv[2]
SIZE = int(sys.argv[3]) if len(sys.argv) > 3 else 1024
os.makedirs(dst, exist_ok=True)
MATS = {
    'track': 'red_dirt_mud_01',
    'loose': 'red_laterite_soil_stones',
    'mud': 'brown_mud_03',
}

def load(path):
    return np.asarray(Image.open(path).convert('RGB').resize((SIZE, SIZE), Image.LANCZOS)).astype(np.float32) / 255

for name, pid in MATS.items():
    diff = load(os.path.join(src, f'{pid}_diff.jpg'))
    nor = load(os.path.join(src, f'{pid}_nor_gl.jpg'))
    arm = load(os.path.join(src, f'{pid}_arm.jpg'))
    ao = arm[..., 0:1]
    # albedo is sRGB: darken by AO in linear space
    lin = diff ** 2.2 * (0.35 + 0.65 * ao ** 0.8)
    alb = np.clip(lin ** (1 / 2.2), 0, 1)
    Image.fromarray((alb * 255 + 0.5).astype(np.uint8)).save(os.path.join(dst, f'{name}_c.jpg'), quality=88)
    packed = np.stack([nor[..., 0], nor[..., 1], arm[..., 1]], -1)
    Image.fromarray((packed * 255 + 0.5).astype(np.uint8)).save(os.path.join(dst, f'{name}_n.jpg'), quality=92)
    print('packed', name, pid)
