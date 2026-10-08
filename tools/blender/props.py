# Trackside props for Super Off Road Remastered, exported as one GLB:
#   Flagman (body), FlagArm (pivot at the shoulder), FlagCloth (plane for waving),
#   StartTower, Drum, HayBale, Tyre, NitroBottle, MoneyBag, RockPillar, Lizard.
# Ambient occlusion is baked into vertex colours.
# Run: blender -b --factory-startup --python tools/blender/props.py -- out.glb [--samples N] [--preview out.png]

import bpy, bmesh, math, sys
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = argv[0] if argv and not argv[0].startswith('--') else '/tmp/props.glb'
SAMPLES = int(argv[argv.index('--samples') + 1]) if '--samples' in argv else 32
PREVIEW = argv[argv.index('--preview') + 1] if '--preview' in argv else None

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
COLL = bpy.context.collection


def material(name, color, metallic=0.0, roughness=0.6, emission=None, strength=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Metallic'].default_value = metallic
    b.inputs['Roughness'].default_value = roughness
    if emission:
        b.inputs['Emission Color'].default_value = (*emission, 1)
        b.inputs['Emission Strength'].default_value = strength
    return m


M = {
    'skin': material('Skin', (0.78, 0.52, 0.38), 0, 0.55),
    'shirt': material('Shirt', (0.92, 0.92, 0.9), 0, 0.7),
    'jeans': material('Jeans', (0.12, 0.18, 0.32), 0, 0.85),
    'boots': material('Boots', (0.18, 0.1, 0.05), 0, 0.6),
    'cap': material('Cap', (0.75, 0.05, 0.04), 0, 0.5),
    'hair': material('Hair', (0.08, 0.05, 0.03), 0, 0.7),
    'wood': material('Wood', (0.45, 0.3, 0.17), 0, 0.8),
    'steel': material('Steel', (0.6, 0.62, 0.65), 0.9, 0.35),
    'yellow': material('SafetyYellow', (0.95, 0.72, 0.05), 0.2, 0.45),
    'canvasR': material('CanvasRed', (0.75, 0.04, 0.03), 0, 0.75),
    'canvasW': material('CanvasWhite', (0.92, 0.92, 0.88), 0, 0.75),
    'sign': material('SignBoard', (0.95, 0.95, 0.95), 0, 0.5),
    'black': material('Black', (0.025, 0.025, 0.028), 0.3, 0.5),
    'flag': material('FlagCloth', (0.1, 0.65, 0.15), 0, 0.8),
    'drumR': material('DrumRed', (0.72, 0.05, 0.04), 0.4, 0.38),
    'drumW': material('DrumWhite', (0.9, 0.9, 0.87), 0.4, 0.38),
    'drumB': material('DrumBlue', (0.08, 0.2, 0.62), 0.4, 0.38),
    'drumTop': material('DrumTop', (0.55, 0.57, 0.6), 0.8, 0.4),
    'hay': material('Hay', (0.72, 0.5, 0.16), 0, 0.95),
    'twine': material('Twine', (0.55, 0.38, 0.18), 0, 0.9),
    'rubber': material('Rubber', (0.025, 0.025, 0.025), 0, 0.85),
    'nitroBlue': material('NitroBlue', (0.06, 0.25, 0.85), 0.5, 0.25),
    'chrome': material('Chrome', (0.9, 0.9, 0.92), 1, 0.12),
    'label': material('Label', (0.95, 0.95, 0.95), 0, 0.35),
    'bag': material('Burlap', (0.32, 0.45, 0.2), 0, 0.9),
    'gold': material('Gold', (0.95, 0.7, 0.2), 1, 0.3),
    'rock': material('Rock', (0.24, 0.12, 0.065), 0, 0.92),
    'rockDark': material('RockDark', (0.15, 0.08, 0.05), 0, 0.95),
    'lizard': material('LizardSkin', (1.0, 1.0, 1.0), 0, 0.5),   # colour comes from the vertex colours
    'crest': material('LizardCrest', (0.95, 0.42, 0.06), 0, 0.5),
    'eye': material('LizardEye', (0.02, 0.02, 0.02), 0, 0.15),
}

PARTS = []


def link(name, me, mat=None, track=True):
    ob = bpy.data.objects.new(name, me)
    COLL.objects.link(ob)
    if mat is not None:
        for m in (mat if isinstance(mat, (list, tuple)) else [mat]):
            me.materials.append(m)
    if track:
        PARTS.append(ob)
    return ob


def mod(ob, kind, **kw):
    m = ob.modifiers.new(kind.lower(), kind)
    for k, v in kw.items():
        setattr(m, k, v)
    return m


def apply_mods(ob):
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    ob.modifiers.clear()
    old = ob.data
    ob.data = me
    bpy.data.meshes.remove(old)


def prim(kind, name, mat, loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1), **kw):
    getattr(bpy.ops.mesh, 'primitive_' + kind + '_add')(location=loc, rotation=rot, **kw)
    ob = bpy.context.active_object
    ob.name = name
    ob.scale = scale
    ob.data.materials.append(mat)
    PARTS.append(ob)
    return ob


def tube(name, a, b, r, mat, verts=10):
    a, b = Vector(a), Vector(b)
    d = b - a
    ob = prim('cylinder', name, mat, loc=(a + b) / 2, vertices=verts, radius=r, depth=d.length)
    ob.rotation_mode = 'QUATERNION'
    ob.rotation_quaternion = d.to_track_quat('Z', 'Y')
    return ob


def bevel(ob, w, seg=2, angle=35):
    mod(ob, 'BEVEL', width=w, segments=seg, limit_method='ANGLE', angle_limit=math.radians(angle))


def join(parts, name, origin=(0, 0, 0)):
    for ob in parts:
        apply_mods(ob)
    bpy.ops.object.select_all(action='DESELECT')
    for ob in parts:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.ops.object.join()
    ob = bpy.context.active_object
    ob.name = name
    # move the origin
    off = Vector(origin)
    ob.data.transform(Matrix.Translation(-off))
    ob.location = off
    ob.data.shade_smooth()
    ob.data.set_sharp_from_angle(angle=math.radians(40))
    for p in parts:
        if p in PARTS:
            PARTS.remove(p)
    return ob


# ------------------------------------------------------------------ flagman (stands at the origin, faces +X)
def flagman():
    P = []
    # legs
    for y in (0.11, -0.11):
        P.append(tube('Leg', (0, y, 0.12), (0.01, y * 0.9, 0.86), 0.085, M['jeans'], 12))
        b = prim('cube', 'Boot', M['boots'], loc=(0.05, y, 0.07), scale=(0.15, 0.065, 0.07))
        bevel(b, 0.03)
        P.append(b)
    hips = prim('cube', 'Hips', M['jeans'], loc=(0, 0, 0.92), scale=(0.12, 0.19, 0.1))
    bevel(hips, 0.05, 3)
    P.append(hips)
    belt = prim('cube', 'Belt', M['boots'], loc=(0, 0, 1.0), scale=(0.125, 0.195, 0.025))
    P.append(belt)
    torso = prim('cube', 'Torso', M['shirt'], loc=(0, 0, 1.24), scale=(0.13, 0.21, 0.24))
    bevel(torso, 0.09, 4)
    P.append(torso)
    neck = tube('Neck', (0, 0, 1.46), (0, 0, 1.56), 0.05, M['skin'])
    P.append(neck)
    head = prim('uv_sphere', 'Head', M['skin'], loc=(0.01, 0, 1.66), segments=20, ring_count=12, radius=0.115)
    head.scale = (1.0, 0.92, 1.1)
    P.append(head)
    hair = prim('uv_sphere', 'Hair', M['hair'], loc=(-0.015, 0, 1.68), segments=16, ring_count=10, radius=0.118)
    hair.scale = (1.0, 0.95, 1.05)
    P.append(hair)
    cap = prim('uv_sphere', 'Cap', M['cap'], loc=(0.01, 0, 1.72), segments=18, ring_count=8, radius=0.123)
    cap.scale = (1.02, 0.96, 0.6)
    P.append(cap)
    brim = prim('cylinder', 'Brim', M['cap'], loc=(0.13, 0, 1.725), vertices=16, radius=0.09, depth=0.015)
    brim.scale = (1.1, 1.0, 1.0)
    P.append(brim)
    # left arm resting (the flag arm is separate)
    P.append(tube('ArmL', (0, 0.24, 1.42), (0.03, 0.27, 1.12), 0.05, M['shirt']))
    P.append(tube('ForearmL', (0.03, 0.27, 1.12), (0.12, 0.24, 0.9), 0.042, M['skin']))
    body = join(P, 'Flagman')
    # flag arm: pivot at the right shoulder, built pointing up (+Z)
    A = []
    sh = Vector((0, -0.24, 1.42))
    A.append(tube('ArmR', sh, sh + Vector((0, -0.04, 0.3)), 0.05, M['shirt']))
    A.append(tube('ForearmR', sh + Vector((0, -0.04, 0.3)), sh + Vector((0.02, -0.05, 0.58)), 0.042, M['skin']))
    hand = prim('uv_sphere', 'Hand', M['skin'], loc=sh + Vector((0.02, -0.05, 0.63)), segments=10, ring_count=8, radius=0.05)
    A.append(hand)
    A.append(tube('Stick', sh + Vector((0.02, -0.05, 0.5)), sh + Vector((0.02, -0.05, 1.55)), 0.016, M['wood'], 8))
    arm = join(A, 'FlagArm', origin=sh)
    # flag cloth: a subdivided plane hanging off the stick top (waved in the game)
    bm = bmesh.new()
    nx, nz = 10, 6
    W, Hh = 0.9, 0.62
    verts = []
    for j in range(nz + 1):
        row = []
        for i in range(nx + 1):
            row.append(bm.verts.new((0.0, -W * i / nx, -Hh * j / nz)))
        verts.append(row)
    uv = bm.loops.layers.uv.new('UVMap')
    for j in range(nz):
        for i in range(nx):
            f = bm.faces.new((verts[j][i], verts[j][i + 1], verts[j + 1][i + 1], verts[j + 1][i]))
            for l, (u, v) in zip(f.loops, [(i / nx, 1 - j / nz), ((i + 1) / nx, 1 - j / nz), ((i + 1) / nx, 1 - (j + 1) / nz), (i / nx, 1 - (j + 1) / nz)]):
                l[uv].uv = (u, v)
    me = bpy.data.meshes.new('FlagCloth')
    bm.to_mesh(me)
    bm.free()
    cloth = link('FlagCloth', me, M['flag'], track=False)
    cloth.location = sh + Vector((0.02, -0.07, 1.53))
    return body, arm, cloth


# ------------------------------------------------------------------ start tower (origin at ground centre, ladder on +X)
def start_tower():
    P = []
    h = 2.6
    for x in (-0.95, 0.95):
        for y in (-0.95, 0.95):
            P.append(tube('Post', (x, y, 0), (x, y, h + 1.1), 0.05, M['steel']))
    for z in (0.9, 1.8):
        for (a, b) in [((-0.95, -0.95), (0.95, -0.95)), ((0.95, -0.95), (0.95, 0.95)), ((0.95, 0.95), (-0.95, 0.95)), ((-0.95, 0.95), (-0.95, -0.95))]:
            P.append(tube('Rail', (*a, z), (*b, z), 0.03, M['steel'], 8))
    # diagonal braces
    P.append(tube('Brace', (-0.95, -0.95, 0.1), (0.95, -0.95, 1.8), 0.025, M['steel'], 8))
    P.append(tube('Brace', (-0.95, 0.95, 0.1), (-0.95, -0.95, 1.8), 0.025, M['steel'], 8))
    plat = prim('cube', 'Deck', M['wood'], loc=(0, 0, h), scale=(1.1, 1.1, 0.06))
    bevel(plat, 0.02)
    P.append(plat)
    # safety railing on top (open towards the track on -Y)
    for (a, b) in [((-1.0, 1.0), (1.0, 1.0)), ((-1.0, 1.0), (-1.0, -1.0)), ((1.0, 1.0), (1.0, -0.2))]:
        P.append(tube('TopRail', (*a, h + 1.05), (*b, h + 1.05), 0.035, M['yellow'], 8))
        P.append(tube('MidRail', (*a, h + 0.55), (*b, h + 0.55), 0.025, M['yellow'], 8))
    # ladder on +X
    for y in (-0.25, 0.25):
        P.append(tube('LadderSide', (1.12, y, 0), (1.12, y, h + 0.9), 0.025, M['steel'], 8))
    for i in range(8):
        P.append(tube('Rung', (1.12, -0.25, 0.3 + i * 0.32), (1.12, 0.25, 0.3 + i * 0.32), 0.018, M['steel'], 6))
    # canopy: striped umbrella over the back half (the flag waves at the front)
    cy = 0.8
    for i in range(8):
        a0, a1 = i * math.pi / 4, (i + 1) * math.pi / 4
        bm = bmesh.new()
        c = bm.verts.new((0, cy, h + 2.45))
        p0 = bm.verts.new((math.cos(a0) * 1.25, cy + math.sin(a0) * 1.25, h + 2.0))
        p1 = bm.verts.new((math.cos(a1) * 1.25, cy + math.sin(a1) * 1.25, h + 2.0))
        bm.faces.new((c, p0, p1))
        me = bpy.data.meshes.new('Canopy')
        bm.to_mesh(me)
        bm.free()
        ob = link('Canopy', me, M['canvasR'] if i % 2 else M['canvasW'])
        mod(ob, 'SOLIDIFY', thickness=0.02)
    P.extend([o for o in PARTS if o.name.startswith('Canopy')])
    P.append(tube('CanopyPole', (0, 0.9, h), (0, cy, h + 2.45), 0.035, M['steel']))
    # FINISH sign board facing the track (-Y)
    sign = prim('cube', 'Sign', M['sign'], loc=(0, -1.0, h - 0.45), scale=(1.0, 0.03, 0.28))
    P.append(sign)
    ob = join(list(dict.fromkeys(P)), 'StartTower')
    return ob


# ------------------------------------------------------------------ giant oil drum (radius 1, height 2 at scale 1)
def drum():
    P = []
    bands = [(0.0, 0.42, 'drumW'), (0.42, 0.62, 'drumR'), (0.62, 1.12, 'drumW'), (1.12, 1.32, 'drumB'), (1.32, 1.86, 'drumW'), (1.86, 2.0, 'drumR')]
    for z0, z1, m in bands:
        P.append(prim('cylinder', 'Band', M[m], loc=(0, 0, (z0 + z1) / 2), vertices=48, radius=1.0, depth=z1 - z0, end_fill_type='NOTHING'))
    for z in (0.02, 0.68, 1.34, 1.98):
        P.append(prim('torus', 'Rib', M['drumTop'], loc=(0, 0, z), major_radius=1.0, minor_radius=0.035, major_segments=48, minor_segments=6))
    top = prim('cylinder', 'Lid', M['drumTop'], loc=(0, 0, 1.97), vertices=48, radius=0.985, depth=0.04)
    P.append(top)
    P.append(prim('cylinder', 'Bung', M['drumTop'], loc=(0.55, 0.2, 2.0), vertices=12, radius=0.09, depth=0.05))
    return join(P, 'Drum')


# ------------------------------------------------------------------ hay bale (1.2 x 0.55 x 0.5)
def hay_bale():
    b = prim('cube', 'Bale', M['hay'], loc=(0, 0, 0.25), scale=(0.6, 0.275, 0.25))
    bevel(b, 0.06, 3)
    mod(b, 'DISPLACE', strength=0.012)
    P = [b]
    for x in (-0.3, 0.3):
        t = prim('torus', 'Twine', M['twine'], loc=(x, 0, 0.25), rot=(0, math.pi / 2, 0), major_radius=0.27, minor_radius=0.008, major_segments=24, minor_segments=4)
        t.scale = (1.0, 1.05, 0.92)
        P.append(t)
    return join(P, 'HayBale')


# ------------------------------------------------------------------ tyre (for stacks)
def tyre():
    t = prim('torus', 'TyreT', M['rubber'], major_radius=0.42, minor_radius=0.17, major_segments=28, minor_segments=10)
    t.scale = (1, 1, 1.15)
    return join([t], 'Tyre')


# ------------------------------------------------------------------ pickups
def nitro_bottle():
    P = []
    P.append(prim('cylinder', 'Body', M['nitroBlue'], loc=(0, 0, 0.6), vertices=24, radius=0.3, depth=1.0))
    P.append(prim('uv_sphere', 'Shoulder', M['nitroBlue'], loc=(0, 0, 1.1), segments=24, ring_count=10, radius=0.3))
    P[-1].scale = (1, 1, 0.55)
    P.append(prim('uv_sphere', 'Bottom', M['nitroBlue'], loc=(0, 0, 0.1), segments=24, ring_count=10, radius=0.3))
    P[-1].scale = (1, 1, 0.35)
    P.append(prim('cylinder', 'Label', M['label'], loc=(0, 0, 0.62), vertices=24, radius=0.305, depth=0.34))
    P.append(prim('cylinder', 'Neck', M['chrome'], loc=(0, 0, 1.3), vertices=16, radius=0.09, depth=0.2))
    P.append(prim('cylinder', 'Valve', M['chrome'], loc=(0, 0, 1.43), vertices=16, radius=0.13, depth=0.08))
    P.append(tube('Knob', (0, 0, 1.43), (0.2, 0, 1.43), 0.035, M['chrome']))
    return join(P, 'NitroBottle')


def money_bag():
    P = []
    sack = prim('uv_sphere', 'Sack', M['bag'], loc=(0, 0, 0.5), segments=28, ring_count=16, radius=0.55)
    sack.scale = (1, 1, 0.92)
    mod(sack, 'DISPLACE', strength=0.03)
    P.append(sack)
    P.append(prim('cone', 'Neck', M['bag'], loc=(0, 0, 1.05), vertices=18, radius1=0.26, radius2=0.12, depth=0.22))
    P.append(prim('torus', 'Tie', M['gold'], loc=(0, 0, 1.08), major_radius=0.14, minor_radius=0.035, major_segments=20, minor_segments=6))
    P.append(prim('cone', 'Top', M['bag'], loc=(0, 0, 1.24), vertices=18, radius1=0.08, radius2=0.26, depth=0.22))
    return join(P, 'MoneyBag')


# ------------------------------------------------------------------ rock pillar (radius ~1, about 4.5 high at scale 1)
def rock_pillar():
    """a hoodoo: stacked, faceted sandstone blocks"""
    tex = bpy.data.textures.new('RockNoise', 'CLOUDS')
    tex.noise_scale = 0.32
    tex.noise_depth = 2
    tex2 = bpy.data.textures.new('RockNoise2', 'VORONOI')
    tex2.noise_scale = 0.55
    P = []
    z = 0.0
    sizes = [(1.2, 1.15, 'rock'), (1.0, 1.25, 'rockDark'), (0.9, 1.05, 'rock'), (0.68, 0.9, 'rockDark'), (0.42, 0.55, 'rock')]
    import random
    random.seed(11)
    for i, (rad, hh, m) in enumerate(sizes):
        ob = prim('ico_sphere', 'Boulder', M[m], loc=(random.uniform(-0.15, 0.15), random.uniform(-0.15, 0.15), z + hh * 0.5), subdivisions=2, radius=1.0)
        ob.scale = (rad * random.uniform(0.95, 1.12), rad * random.uniform(0.8, 1.0), hh * 0.6)
        ob.rotation_euler = (random.uniform(-0.25, 0.25), random.uniform(-0.25, 0.25), random.uniform(0, 6.28))
        mod(ob, 'DISPLACE', strength=0.42, texture=tex, texture_coords='OBJECT')
        mod(ob, 'DISPLACE', strength=0.18, texture=tex2, texture_coords='OBJECT')
        mod(ob, 'DECIMATE', decimate_type='COLLAPSE', ratio=0.55)
        P.append(ob)
        z += hh * 0.9
    ob = join(P, 'RockPillar')
    ob.data.shade_flat()   # faceted stone
    return ob


# ------------------------------------------------------------------ giant lizard statue (Leapin' Lizards), ~5 m long at scale 1, faces +X
def sweep(name, pts, rh, mat, rv=None, segs=14, cap_end=True):
    """tube along a polyline with horizontal/vertical radii per point (elliptical section)"""
    rv = rv or rh
    bm = bmesh.new()
    rings = []
    up = Vector((0, 0, 1))
    for i, p in enumerate(pts):
        p = Vector(p)
        a, b = Vector(pts[max(0, i - 1)]), Vector(pts[min(len(pts) - 1, i + 1)])
        t = (b - a).normalized()
        n = t.cross(up)
        if n.length < 1e-4:
            n = t.cross(Vector((0, 1, 0)))
        n.normalize()
        bb = n.cross(t).normalized()
        rings.append([bm.verts.new(p + rh[i] * math.cos(2 * math.pi * k / segs) * n + rv[i] * math.sin(2 * math.pi * k / segs) * bb) for k in range(segs)])
    for i in range(len(rings) - 1):
        for k in range(segs):
            k2 = (k + 1) % segs
            bm.faces.new((rings[i][k], rings[i][k2], rings[i + 1][k2], rings[i + 1][k]))
    if cap_end:
        d = (Vector(pts[-1]) - Vector(pts[-2])).normalized()
        tip = bm.verts.new(Vector(pts[-1]) + d * min(rh[-1], rv[-1]))
        for k in range(segs):
            bm.faces.new((rings[-1][k], rings[-1][(k + 1) % segs], tip))
    bm.faces.new(rings[0][::-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    return link(name, me, mat)


def lizard():
    P = []
    # spine from the snout to the tip of the curled tail
    spine = [(1.9, 0, 0.3), (1.62, 0, 0.36), (1.32, 0, 0.38), (1.08, 0, 0.37), (0.75, 0, 0.4), (0.3, 0, 0.42), (-0.15, 0, 0.41),
             (-0.6, 0, 0.38), (-1.05, 0.04, 0.32), (-1.55, 0.2, 0.25), (-2.05, 0.48, 0.18), (-2.5, 0.88, 0.13), (-2.8, 1.35, 0.09),
             (-2.9, 1.82, 0.07), (-2.78, 2.2, 0.06)]
    rh = [0.1, 0.25, 0.27, 0.21, 0.36, 0.42, 0.42, 0.37, 0.27, 0.2, 0.15, 0.11, 0.08, 0.06, 0.04]
    rv = [0.07, 0.16, 0.18, 0.16, 0.25, 0.3, 0.3, 0.26, 0.2, 0.15, 0.11, 0.08, 0.06, 0.045, 0.03]
    P.append(sweep('LizBody', spine, rh, M['lizard'], rv, segs=20))
    # splayed legs: shoulder/hip -> elbow/knee -> wrist/ankle, with a foot and three toes
    for side in (1, -1):
        for (a, b, c, r0) in [((0.72, 0.25, 0.36), (0.95, 0.74, 0.44), (1.02, 0.86, 0.08), 0.15),
                              ((-0.55, 0.25, 0.34), (-0.78, 0.8, 0.42), (-0.55, 0.98, 0.08), 0.17)]:
            a = (a[0], a[1] * side, a[2]); b = (b[0], b[1] * side, b[2]); c = (c[0], c[1] * side, c[2])
            P.append(sweep('Leg', [a, b, c], [r0, r0 * 0.75, r0 * 0.55], M['lizard'], segs=10))
            foot = prim('uv_sphere', 'Foot', M['lizard'], loc=(c[0], c[1], 0.05), segments=12, ring_count=6, radius=0.13)
            foot.scale = (1.2, 1.0, 0.45)
            P.append(foot)
            fwd = 1 if c[0] > 0 else 0.6
            for ang in (-0.6, 0.0, 0.6):
                d = Vector((math.cos(ang) * fwd, math.sin(ang) * side + 0.35 * side, 0)).normalized()
                tip = Vector((c[0], c[1], 0.04)) + d * 0.3
                P.append(sweep('Toe', [(c[0], c[1], 0.05), tuple(tip)], [0.045, 0.03], M['lizard'], segs=6))
    # orange crest along the back
    for x, z in [(1.0, 0.52), (0.78, 0.62), (0.52, 0.69), (0.26, 0.71), (0.0, 0.71), (-0.26, 0.69), (-0.52, 0.64), (-0.78, 0.57), (-1.02, 0.5)]:
        P.append(prim('cone', 'Crest', M['crest'], loc=(x, 0, z + 0.07), vertices=8, radius1=0.08, radius2=0.0, depth=0.2))
    # eyes with a golden ring
    for side in (1, -1):
        P.append(prim('uv_sphere', 'EyeRing', M['gold'], loc=(1.5, 0.2 * side, 0.46), segments=12, ring_count=8, radius=0.085))
        P.append(prim('uv_sphere', 'Eye', M['eye'], loc=(1.53, 0.22 * side, 0.47), segments=12, ring_count=8, radius=0.068))
    ob = join(P, 'Lizard')
    return ob


def paint_lizard(ob):
    """green back with dark bands, pale belly; multiplied into the baked AO (linear colours)"""
    lin = lambda c: tuple(x ** 2.2 for x in c)
    back, band, belly = lin((0.3, 0.62, 0.16)), lin((0.1, 0.3, 0.07)), lin((0.82, 0.84, 0.42))
    me = ob.data
    ca = me.color_attributes['AO']
    skin = [i for i, m in enumerate(me.materials) if m and m.name.startswith('LizardSkin')]
    for poly in me.polygons:
        if poly.material_index not in skin:
            continue
        for li in poly.loop_indices:
            vert = me.vertices[me.loops[li].vertex_index]
            co, nz = vert.co, vert.normal.z
            v = ca.data[li].color[0]
            # pale where the skin faces down (belly, under the legs), dark bands across the back and tail
            w = max(0.0, min(1.0, (nz + 0.25) / 0.5))
            k = 1.0 if (math.sin((co.x - 0.35 * co.y) * 6.5) > 0.3 and nz > 0.45) else 0.0
            col = [belly[i] * (1 - w) + (back[i] * (1 - k) + band[i] * k) * w for i in range(3)]
            ca.data[li].color = (v * col[0], v * col[1], v * col[2], 1.0)


fm_body, fm_arm, fm_cloth = flagman()
liz = lizard()
rock = rock_pillar()
tower = start_tower()
drm = drum()
bale = hay_bale()
tyr = tyre()
nitro = nitro_bottle()
bag = money_bag()
objs = [fm_body, fm_arm, fm_cloth, tower, drm, bale, tyr, nitro, bag, rock, liz]

# spread them out for baking so they do not occlude each other, bake AO, then put back
home = {}
for i, ob in enumerate(objs):
    home[ob.name] = ob.location.copy()
    ob.location = Vector((i * 12.0, 0, 0)) + (ob.location if ob.name in ('FlagArm', 'FlagCloth') else Vector((0, 0, 0)))
# flagman parts must bake together
fm_arm.location = fm_body.location + home['FlagArm']
fm_cloth.location = fm_body.location + home['FlagCloth']
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = SAMPLES
scene.world = bpy.data.worlds.new('W')
scene.world.light_settings.distance = 0.5
bpy.ops.mesh.primitive_plane_add(size=400, location=(40, 0, 0))
ground = bpy.context.active_object
for ob in objs:
    me = ob.data
    if 'AO' not in me.color_attributes:
        me.color_attributes.new('AO', 'FLOAT_COLOR', 'CORNER')
    me.color_attributes.active_color = me.color_attributes['AO']
bpy.ops.object.select_all(action='DESELECT')
for ob in objs:
    ob.select_set(True)
bpy.context.view_layer.objects.active = objs[0]
bpy.ops.object.bake(type='AO', target='VERTEX_COLORS', use_clear=True)
for ob in objs:
    ca = ob.data.color_attributes['AO']
    for d in ca.data:
        v = 0.25 + 0.75 * (d.color[0] ** 0.8)
        d.color = (v, v, v, 1.0)
paint_lizard(liz)
bpy.data.objects.remove(ground)
for ob in objs:
    ob.location = home[ob.name]

bpy.ops.object.select_all(action='DESELECT')
for ob in objs:
    ob.select_set(True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
                          export_vertex_color='ACTIVE', export_materials='EXPORT', export_image_format='NONE',
                          export_animations=False, export_cameras=False, export_lights=False,
                          export_meshopt_compression_enable=True)
tri = lambda ob: sum(len(p.vertices) - 2 for p in ob.data.polygons)
print('EXPORTED', OUT, {ob.name: tri(ob) for ob in objs})

if PREVIEW:
    for i, ob in enumerate(objs):
        if ob.name in ('FlagArm', 'FlagCloth'):
            continue
    # simple lineup render
    for i, ob in enumerate([tower, drm, bale, tyr, nitro, bag]):
        ob.location = (i * 3.2 - 6, 4, 0)
    tower.location = (-8, 0, 0)
    fm_body.location = (-8, 0, 2.66)
    fm_arm.location = fm_body.location + home['FlagArm']
    fm_arm.rotation_euler = (math.radians(-35), 0, 0)
    fm_cloth.location = fm_body.location + home['FlagCloth']
    sun = bpy.data.lights.new('Sun', 'SUN'); sun.energy = 4
    so = bpy.data.objects.new('Sun', sun); COLL.objects.link(so); so.rotation_euler = (math.radians(50), 0, math.radians(-40))
    scene.world.use_nodes = True
    scene.world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.5, 0.6, 0.75, 1)
    bpy.ops.mesh.primitive_plane_add(size=80, location=(0, 0, 0))
    gm = material('G', (0.3, 0.17, 0.1), 0, 0.9); bpy.context.active_object.data.materials.append(gm)
    cam = bpy.data.cameras.new('C'); cam.lens = 35
    co = bpy.data.objects.new('C', cam); COLL.objects.link(co)
    co.location = (-2, -14, 7)
    co.rotation_euler = (Vector((-1, 2, 1.5)) - co.location).to_track_quat('-Z', 'Y').to_euler()
    scene.camera = co
    scene.render.resolution_x, scene.render.resolution_y = 1280, 640
    scene.cycles.samples = 48
    scene.render.filepath = PREVIEW
    bpy.ops.render.render(write_still=True)
    # the lizard on its own, showing its vertex colours
    nt = M['lizard'].node_tree
    attr = nt.nodes.new('ShaderNodeVertexColor')
    attr.layer_name = 'AO'
    nt.links.new(attr.outputs['Color'], nt.nodes['Principled BSDF'].inputs['Base Color'])
    liz.location = (0, -6, 0)
    co.location = (5.5, -13.5, 4.2)
    co.rotation_euler = (Vector((-0.6, -5.6, 0.4)) - co.location).to_track_quat('-Z', 'Y').to_euler()
    scene.render.filepath = PREVIEW.replace('.png', '_lizard.png')
    bpy.ops.render.render(write_still=True)
    co.location = (-0.4, -6.0, 11)
    co.rotation_euler = (math.radians(0), 0, math.radians(90))
    scene.render.filepath = PREVIEW.replace('.png', '_lizard_top.png')
    bpy.ops.render.render(write_still=True)
