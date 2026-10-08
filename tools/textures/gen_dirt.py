"""Tileable dirt textures for the stadium floor (albedo + normal/AO/roughness).

python3 tools/textures/gen_dirt.py assets/textures

Outputs, all 1024x1024 and seamless:
  dirt_track.jpg / dirt_track_n.png  packed, raked clay of the racing surface
  dirt_loose.jpg / dirt_loose_n.png  loose infield dirt with clods and pebbles
The *_n.png files hold the normal (RG), ambient occlusion (B) and roughness (A).
"""
import sys, os
import numpy as np
from PIL import Image

N = 1024
rng = np.random.default_rng(1989)
out_dir = sys.argv[1] if len(sys.argv) > 1 else '.'
os.makedirs(out_dir, exist_ok=True)

fx = np.fft.fftfreq(N)[:, None]
fy = np.fft.fftfreq(N)[None, :]
FR = np.sqrt(fx * fx + fy * fy)
FR[0, 0] = 1.0


def fractal(beta, lo=0.0, hi=0.5, seed=None):
    """periodic 1/f^beta noise, normalised to [-1, 1]"""
    r = np.random.default_rng(seed) if seed is not None else rng
    w = r.standard_normal((N, N))
    F = np.fft.fft2(w) / FR ** (beta / 2)
    F[(FR < lo) | (FR > hi)] = 0
    F[0, 0] = 0
    n = np.real(np.fft.ifft2(F))
    return n / (np.abs(n).max() + 1e-9)


def blur(a, sigma):
    F = np.fft.fft2(a)
    g = np.exp(-2 * (np.pi * sigma) ** 2 * (fx * fx + fy * fy))
    return np.real(np.fft.ifft2(F * g))


def stamp_domes(H, C, count, rmin, rmax, hscale, colors, aspect=(0.6, 1.0), seed=1, color_out=True):
    r = np.random.default_rng(seed)
    for _ in range(count):
        cx, cy = r.uniform(0, N), r.uniform(0, N)
        rad = r.uniform(rmin, rmax)
        a = r.uniform(0, np.pi)
        asp = r.uniform(*aspect)
        R = int(rad + 2)
        ys, xs = np.mgrid[-R:R + 1, -R:R + 1]
        u = (xs * np.cos(a) + ys * np.sin(a)) / rad
        v = (-xs * np.sin(a) + ys * np.cos(a)) / (rad * asp)
        d = u * u + v * v
        m = d < 1
        h = np.sqrt(np.clip(1 - d, 0, 1)) * hscale * rad
        # irregular top
        h *= 1 + 0.25 * np.sin(u * 5 + r.uniform(0, 6)) * np.cos(v * 4 + r.uniform(0, 6))
        col = np.array(colors[r.integers(len(colors))]) * r.uniform(0.82, 1.15)
        iy = (ys + int(cy)) % N
        ix = (xs + int(cx)) % N
        Hsub = H[iy, ix]
        upd = m & (h > Hsub - 0.0)
        H[iy[upd], ix[upd]] = np.maximum(Hsub[upd], h[upd])
        if color_out:
            shade = 0.85 + 0.3 * (u[upd] * -0.5 + v[upd] * -0.5)  # baked micro light from top-left
            C[iy[upd], ix[upd]] = col * shade[:, None]


def voronoi_cracks(cells, seed):
    r = np.random.default_rng(seed)
    pts = r.uniform(0, N, (cells, 2))
    # tile the points for wrap-around
    allp = []
    for dx in (-N, 0, N):
        for dy in (-N, 0, N):
            allp.append(pts + [dx, dy])
    allp = np.concatenate(allp)
    yy, xx = np.mgrid[0:N, 0:N]
    d1 = np.full((N, N), 1e9)
    d2 = np.full((N, N), 1e9)
    for p in allp:
        d = (xx - p[0]) ** 2 + (yy - p[1]) ** 2
        upd = d < d1
        d2 = np.where(upd, d1, np.minimum(d2, d))
        d1 = np.where(upd, d, d1)
    edge = np.sqrt(d2) - np.sqrt(d1)
    return edge


def normal_map(H, strength):
    gx = (np.roll(H, -1, 1) - np.roll(H, 1, 1)) * 0.5 * strength
    gy = (np.roll(H, -1, 0) - np.roll(H, 1, 0)) * 0.5 * strength
    nz = 1.0 / np.sqrt(gx * gx + gy * gy + 1)
    nx = -gx * nz
    ny = -gy * nz
    return nx, ny, nz


def save(name, albedo, H, rough, nstrength):
    a = np.clip(albedo, 0, 1)
    Image.fromarray((a ** (1 / 2.2) * 255).astype(np.uint8)).save(os.path.join(out_dir, name + '.jpg'), quality=90)
    nx, ny, nz = normal_map(H, nstrength)
    ao = np.clip(1 - np.maximum(0, blur(H, 6) - H) * 0.09, 0.35, 1)
    img = np.stack([(nx * 0.5 + 0.5), (ny * 0.5 + 0.5), ao, np.clip(rough, 0, 1)], -1)
    Image.fromarray((img * 255).astype(np.uint8), 'RGBA').save(os.path.join(out_dir, name + '_n.png'), optimize=True)
    print('saved', name)


# ------------------------------------------------------------------ packed track clay
def track():
    base = np.array([0.36, 0.20, 0.11])
    n1 = fractal(2.6, 0.002, 0.5, 11)
    n2 = fractal(1.6, 0.02, 0.5, 12)
    n3 = fractal(1.0, 0.1, 0.5, 13)
    H = n1 * 6 + n2 * 1.6 + n3 * 0.5
    # tyre compaction streaks (along x) and fine rake lines
    yy, xx = np.mgrid[0:N, 0:N] / N
    streak = fractal(2.0, 0.003, 0.5, 14)
    streak = blur(streak, 1)
    rake = np.sin(yy * np.pi * 2 * 48 + fractal(2.5, 0.001, 0.05, 15) * 6) * 0.5
    H += rake * 0.8 + streak * 1.5
    # dried cracks in patches
    edge = voronoi_cracks(70, 16)
    crack = np.clip(1 - edge / 2.2, 0, 1) * (fractal(2.4, 0.001, 0.02, 17) > 0.15)
    H -= crack * 3.5
    C = np.ones((N, N, 3)) * base
    C *= (1 + n1[..., None] * 0.18 + n2[..., None] * 0.08 + n3[..., None] * 0.05)
    C *= (1 + rake[..., None] * 0.035)
    # lighter dusty patches
    dust = np.clip(fractal(2.2, 0.002, 0.2, 18) * 1.6, 0, 1)
    C = C * (1 - dust[..., None] * 0.3) + np.array([0.52, 0.36, 0.24]) * dust[..., None] * 0.3
    C *= (1 - crack[..., None] * 0.55)
    # small embedded stones
    H2 = np.zeros((N, N))
    stamp_domes(H2, C, 420, 2.0, 5.0, 0.6, [(0.42, 0.36, 0.30), (0.50, 0.44, 0.36), (0.33, 0.24, 0.18), (0.55, 0.50, 0.45)], seed=19)
    H = H + H2 * 1.4
    rough = 0.9 - H2 * 0.03 + n3 * 0.04
    save('dirt_track', C, H, rough, 0.55)


# ------------------------------------------------------------------ loose infield dirt
def loose():
    base = np.array([0.40, 0.25, 0.14])
    n1 = fractal(2.4, 0.002, 0.5, 21)
    n2 = fractal(1.5, 0.02, 0.5, 22)
    n3 = fractal(0.8, 0.1, 0.5, 23)
    H = n1 * 8 + n2 * 2.5 + n3 * 0.8
    C = np.ones((N, N, 3)) * base
    C *= (1 + n1[..., None] * 0.2 + n2[..., None] * 0.1 + n3[..., None] * 0.07)
    # dark damp patches
    damp = np.clip(fractal(2.3, 0.002, 0.2, 24) * 1.8 - 0.3, 0, 1)
    C *= (1 - damp[..., None] * 0.25)
    # clods of dirt
    Hc = np.zeros((N, N))
    stamp_domes(Hc, C, 260, 4, 13, 0.55, [(0.36, 0.22, 0.12), (0.30, 0.18, 0.10), (0.42, 0.27, 0.15)], aspect=(0.5, 1.0), seed=25)
    # pebbles and rocks
    stamp_domes(Hc, C, 700, 1.5, 4.5, 0.7, [(0.48, 0.42, 0.36), (0.58, 0.52, 0.45), (0.36, 0.30, 0.25), (0.62, 0.56, 0.50), (0.44, 0.30, 0.22)], seed=26)
    stamp_domes(Hc, C, 40, 6, 10, 0.6, [(0.50, 0.46, 0.42), (0.42, 0.38, 0.34)], seed=27)
    H = H + Hc * 1.6
    # cavity darkening
    cav = np.maximum(0, blur(H, 3) - H)
    C *= (1 - np.clip(cav * 0.06, 0, 0.45))[..., None]
    rough = 0.95 - Hc * 0.015
    save('dirt_loose', C, H, rough, 0.7)


track()
loose()
