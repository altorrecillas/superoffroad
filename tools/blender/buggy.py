# Dune buggy (the Track Pak vehicle): tube frame, fibreglass nose, rear boxer
# engine. Exports Body, WheelF, WheelR (left wheels at the origin) and markers.
# Run: blender -b --factory-startup --python tools/blender/buggy.py -- out.glb [--preview out.png] [--samples N]

import bpy, bmesh, math, sys
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = argv[0] if argv and not argv[0].startswith('--') else '/tmp/buggy.glb'
PREVIEW = argv[argv.index('--preview') + 1] if '--preview' in argv else None
SAMPLES = int(argv[argv.index('--samples') + 1]) if '--samples' in argv else 48

# wheel layout (x forward, y left): matches the physics wheel base of the truck
FX, RX = 1.38, -1.3
FY, RY = 0.92, 0.98
FR, RR = 0.4, 0.5

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
COLL = bpy.context.collection


def material(name, color, metallic=0.0, roughness=0.5, coat=0.0, emission=None, strength=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Metallic'].default_value = metallic
    b.inputs['Roughness'].default_value = roughness
    if coat:
        b.inputs['Coat Weight'].default_value = coat
        b.inputs['Coat Roughness'].default_value = 0.05
    if emission:
        b.inputs['Emission Color'].default_value = (*emission, 1)
        b.inputs['Emission Strength'].default_value = strength
    return m


M = {
    'paint': material('Paint', (0.8, 0.8, 0.8), 0.25, 0.32, coat=1.0),
    'accent': material('Accent', (0.92, 0.92, 0.92), 0.1, 0.35, coat=1.0),
    'tube': material('Tube', (0.035, 0.035, 0.038), 0.7, 0.32),
    'black': material('Black', (0.022, 0.022, 0.025), 0.35, 0.5),
    'chrome': material('Chrome', (0.92, 0.92, 0.94), 1.0, 0.1),
    'engine': material('Engine', (0.32, 0.33, 0.35), 0.8, 0.4),
    'rubber': material('Rubber', (0.022, 0.021, 0.02), 0.0, 0.84),
    'rim': material('Rim', (0.62, 0.62, 0.66), 1.0, 0.24),
    'bead': material('Beadlock', (0.78, 0.52, 0.16), 1.0, 0.28),
    'lens': material('Lens', (0.9, 0.9, 0.92), 0.0, 0.05, emission=(1.0, 0.96, 0.85), strength=1.2),
    'tail': material('TailLight', (0.5, 0.02, 0.02), 0.0, 0.1, emission=(1.0, 0.06, 0.03), strength=1.0),
    'decal': material('Decal', (0.92, 0.92, 0.92), 0.0, 0.32, coat=1.0),
    'decal_roof': material('DecalRoof', (0.92, 0.92, 0.92), 0.0, 0.32, coat=1.0),
    'helmet': material('Helmet', (0.9, 0.9, 0.9), 0.1, 0.22, coat=1.0),
    'suit': material('Suit', (0.12, 0.12, 0.14), 0.0, 0.7),
    'seat': material('Seat', (0.06, 0.06, 0.07), 0.0, 0.7),
    'flag': material('Flag', (1.0, 0.32, 0.02), 0.0, 0.6, emission=(1.0, 0.25, 0.0), strength=0.15),
    'shock': material('Shock', (0.85, 0.62, 0.2), 1.0, 0.22),
}

PARTS = []


def link(name, me, mat=None, part=True):
    ob = bpy.data.objects.new(name, me)
    COLL.objects.link(ob)
    if mat is not None:
        for m in (mat if isinstance(mat, (list, tuple)) else [mat]):
            me.materials.append(m)
    if part:
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


def bevel(ob, w, seg=2, angle=35):
    mod(ob, 'BEVEL', width=w, segments=seg, limit_method='ANGLE', angle_limit=math.radians(angle))


def box(name, size, loc, mat, bev=0.0, seg=2, rot=(0, 0, 0)):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * size[0], v.co.y * size[1], v.co.z * size[2]))
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = link(name, me, mat)
    ob.location = loc
    ob.rotation_euler = rot
    if bev:
        bevel(ob, bev, seg, 30)
    return ob


def cyl(name, r, depth, loc, mat, axis='X', verts=20, bev=0.0):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=verts, radius1=r, radius2=r, depth=depth)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = link(name, me, mat)
    ob.location = loc
    if axis == 'X':
        ob.rotation_euler = (0, math.pi / 2, 0)
    elif axis == 'Y':
        ob.rotation_euler = (math.pi / 2, 0, 0)
    if bev:
        bevel(ob, bev, 2, 30)
    return ob


def tube(name, pts, r, mat):
    cu = bpy.data.curves.new(name, 'CURVE')
    cu.dimensions = '3D'
    cu.bevel_depth = r
    cu.bevel_resolution = 3
    cu.use_fill_caps = True
    sp = cu.splines.new('POLY')
    sp.points.add(len(pts) - 1)
    for p, c in zip(sp.points, pts):
        p.co = (*c, 1)
    ob = bpy.data.objects.new(name, cu)
    COLL.objects.link(ob)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    bpy.data.objects.remove(ob)
    me.materials.clear()
    return link(name, me, mat)


def bend(name, pts, r, mat, rad=0.1, seg=4):
    out = [Vector(pts[0])]
    for i in range(1, len(pts) - 1):
        a, b, c = Vector(pts[i - 1]), Vector(pts[i]), Vector(pts[i + 1])
        d1 = (b - a).normalized(); d2 = (c - b).normalized()
        t = min(rad, (b - a).length * 0.45, (c - b).length * 0.45)
        p0, p1 = b - d1 * t, b + d2 * t
        for k in range(seg + 1):
            u = k / seg
            out.append((1 - u) ** 2 * p0 + 2 * (1 - u) * u * b + u * u * p1)
    out.append(Vector(pts[-1]))
    return tube(name, [tuple(p) for p in out], r, mat)


def prism(name, prof, y0, y1, mat, bev=0.0, seg=3):
    bm = bmesh.new()
    v0 = [bm.verts.new((x, y0, z)) for x, z in prof]
    v1 = [bm.verts.new((x, y1, z)) for x, z in prof]
    n = len(prof)
    bm.faces.new(v0[::-1])
    bm.faces.new(v1)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((v0[i], v0[j], v1[j], v1[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = link(name, me, mat)
    if bev:
        bevel(ob, bev, seg)
    return ob


# ------------------------------------------------------------------ body
# fibreglass nose tub (paint) in front of the driver
prism('Nose', [(0.25, 0.55), (1.95, 0.6), (2.12, 0.72), (2.08, 0.86), (1.6, 0.98), (0.25, 1.12)], -0.62, 0.62, M['paint'], bev=0.07, seg=4)
# accent racing stripe lying on the sloped nose top
NOSE_TILT = math.atan2(1.12 - 0.98, 1.6 - 0.25)
nose_top = lambda x: 1.12 - math.tan(NOSE_TILT) * (x - 0.25)
for s_ in (1, -1):
    box('HoodStripe', (1.24, 0.1, 0.02), (0.98, 0.17 * s_, nose_top(0.98) + 0.006), M['accent'], rot=(0, NOSE_TILT, 0))
# round headlights in the nose
for s_ in (1, -1):
    cyl('HeadLamp', 0.075, 0.1, (2.07, 0.4 * s_, 0.79), M['black'], axis='X', verts=18, bev=0.01)
    cyl('HeadLens', 0.062, 0.012, (2.122, 0.4 * s_, 0.79), M['lens'], axis='X', verts=18)
# floor pan and side pods
box('Floor', (3.4, 1.2, 0.06), (-0.1, 0, 0.5), M['black'])
for s in (1, -1):
    prism('Pod', [(-0.7, 0.5), (0.4, 0.5), (0.5, 0.82), (-0.65, 0.88)], 0.6 * s - 0.08, 0.6 * s + 0.08, M['paint'], bev=0.04)
# seat, driver, dash
box('Seat', (0.45, 0.52, 0.12), (-0.25, 0.0, 0.6), M['seat'], bev=0.04)
box('SeatBack', (0.12, 0.52, 0.7), (-0.55, 0.0, 0.95), M['seat'], bev=0.05)
bpy.ops.mesh.primitive_uv_sphere_add(segments=20, ring_count=12, radius=0.16, location=(-0.3, 0.0, 1.55))
h = bpy.context.active_object; h.name = 'Helmet'; h.data.materials.append(M['helmet']); PARTS.append(h)
box('Torso', (0.32, 0.46, 0.5), (-0.35, 0.0, 1.05), M['suit'], bev=0.08)
box('Visor', (0.05, 0.22, 0.08), (-0.15, 0.0, 1.56), M['black'], bev=0.02)
box('Dash', (0.12, 0.8, 0.2), (0.32, 0, 1.0), M['black'], bev=0.03)
# ------------------------------------------------------------------ tube frame
for s in (1, -1):
    # main hoop behind the seat
    bend('Hoop', [(-0.62, 0.62 * s, 0.52), (-0.66, 0.58 * s, 1.55), (-0.6, 0.42 * s, 1.85)], 0.045, M['tube'], rad=0.2)
    # A-pillar from the nose to the hoop top
    bend('APillar', [(0.6, 0.6 * s, 0.95), (0.05, 0.48 * s, 1.75), (-0.6, 0.42 * s, 1.85)], 0.04, M['tube'], rad=0.3)
    # side bar
    bend('Side', [(0.6, 0.66 * s, 0.6), (-0.66, 0.66 * s, 0.62)], 0.04, M['tube'])
    # rear cage over the engine down to the bumper
    bend('Rear', [(-0.66, 0.58 * s, 1.45), (-1.9, 0.55 * s, 1.05), (-2.05, 0.5 * s, 0.6)], 0.04, M['tube'], rad=0.25)
    bend('Bump', [(-0.66, 0.6 * s, 0.6), (-2.0, 0.55 * s, 0.6)], 0.035, M['tube'])
    # front bumper and nerf bar
    bend('NoseBar', [(1.9, 0.55 * s, 0.62), (2.25, 0.4 * s, 0.62), (2.25, 0.0, 0.62)], 0.04, M['tube'], rad=0.2)
bend('HoopTop', [(-0.6, -0.42, 1.85), (-0.6, 0.42, 1.85)], 0.045, M['tube'])
bend('RearCross', [(-2.05, -0.5, 0.6), (-2.05, 0.5, 0.6)], 0.04, M['tube'])
bend('RearCross2', [(-1.9, -0.55, 1.05), (-1.9, 0.55, 1.05)], 0.035, M['tube'])
bend('Diag', [(-0.66, 0.58, 1.45), (-1.9, -0.55, 1.05)], 0.032, M['tube'])
# painted roof panel over the cage (the colour and number read from the overhead camera)
ROOF_TILT = 0.15
ROOF_C = Vector((-0.3, 0.0, 1.875))
box('Roof', (0.74, 0.98, 0.035), tuple(ROOF_C), M['paint'], bev=0.012, rot=(0, ROOF_TILT, 0))
# lamps on the front edge of the roof
box('LampBar', (0.05, 0.78, 0.035), (0.08, 0, 1.815), M['tube'], bev=0.01)
for y in (-0.26, 0.26):
    cyl('Lamp', 0.085, 0.1, (0.1, y, 1.875), M['black'], axis='X', verts=18, bev=0.01)
    cyl('LampLens', 0.072, 0.012, (0.153, y, 1.875), M['lens'], axis='X', verts=18)
# ------------------------------------------------------------------ engine (VW flat four) + exhaust
box('Engine', (0.55, 0.75, 0.38), (-1.45, 0, 0.82), M['engine'], bev=0.05)
for s in (1, -1):
    for k in range(2):
        cyl('Cyl', 0.1, 0.3, (-1.3 - k * 0.24, 0.48 * s, 0.82), M['engine'], axis='Y', verts=14)
box('Fan', (0.4, 0.4, 0.26), (-1.45, 0, 1.12), M['black'], bev=0.04)
cyl('AirCleaner', 0.14, 0.12, (-1.25, 0, 1.3), M['chrome'], axis=None, verts=20, bev=0.02)
bend('Stinger', [(-1.6, 0.0, 0.62), (-2.1, 0.0, 0.72), (-2.32, 0.0, 0.95)], 0.055, M['chrome'], rad=0.15)
cyl('Tip', 0.07, 0.12, (-2.36, 0, 1.0), M['black'], axis=None, verts=14)
for s in (1, -1):
    box('Tail', (0.04, 0.12, 0.08), (-2.06, 0.42 * s, 0.98), M['tail'], bev=0.01)
    # coilovers
    p0, p1 = Vector((RX + 0.15, 0.62 * s, 0.6)), Vector((RX + 0.35, 0.5 * s, 1.35))
    d = p1 - p0
    c = cyl('ShockR', 0.05, d.length, (p0 + p1) / 2, M['shock'], axis=None, verts=12)
    c.rotation_mode = 'QUATERNION'; c.rotation_quaternion = d.to_track_quat('Z', 'Y')
    p0, p1 = Vector((FX - 0.06, 0.7 * s, 0.5)), Vector((FX - 0.22, 0.5 * s, 0.93))
    d = p1 - p0
    c = cyl('ShockF', 0.045, d.length, (p0 + p1) / 2, M['shock'], axis=None, verts=12)
    c.rotation_mode = 'QUATERNION'; c.rotation_quaternion = d.to_track_quat('Z', 'Y')
    # trailing arms
    bend('ArmR', [(-0.62, 0.55 * s, 0.55), (RX, (RY - 0.15) * s, RR)], 0.04, M['tube'])
    bend('ArmF', [(1.0, 0.45 * s, 0.6), (FX, (FY - 0.12) * s, FR)], 0.04, M['tube'])
    # number panels on the pods
# number plates: on the nose sides and the hood
def plate(name, center, size, axis, flip, mat):
    cx, cy, cz = center
    w, hh = size
    bm = bmesh.new()
    if axis == 'Y':
        s = 1 if not flip else -1
        vs = [bm.verts.new((cx - w / 2 * s, cy, cz - hh / 2)), bm.verts.new((cx + w / 2 * s, cy, cz - hh / 2)),
              bm.verts.new((cx + w / 2 * s, cy, cz + hh / 2)), bm.verts.new((cx - w / 2 * s, cy, cz + hh / 2))]
    else:
        vs = [bm.verts.new((cx - w / 2, cy + hh / 2, cz)), bm.verts.new((cx - w / 2, cy - hh / 2, cz)),
              bm.verts.new((cx + w / 2, cy - hh / 2, cz)), bm.verts.new((cx + w / 2, cy + hh / 2, cz))]
    f = bm.faces.new(vs)
    uv = bm.loops.layers.uv.new('UVMap')
    for l, (u, v) in zip(f.loops, [(0, 0), (1, 0), (1, 1), (0, 1)]):
        l[uv].uv = (u, v)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = link(name, me, mat)
    n = ob.data.polygons[0].normal
    want = Vector((0, 1 if cy > 0 else -1, 0)) if axis == 'Y' else Vector((0, 0, 1))
    if n.dot(want) < 0:
        ob.data.flip_normals()
    return ob


plate('NumL', (1.05, 0.627, 0.86), (0.62, 0.32), 'Y', True, M['decal'])
plate('NumR', (1.05, -0.627, 0.86), (0.62, 0.32), 'Y', False, M['decal'])
roof = plate('RoofNum', (0, 0, 0), (0.44, 0.88), 'Z', False, M['decal_roof'])
roof.location = ROOF_C + Vector((0, 0, 0.0175 + 0.004))
roof.rotation_euler = (0, ROOF_TILT, 0)


# ------------------------------------------------------------------ wheels
def wheel(name, R, W, lugs, lod=False):
    parts = []
    inner = R * 0.55
    prof = [(inner, -W * 0.45), (R * 0.8, -W * 0.5), (R * 0.95, -W * 0.48), (R, -W * 0.36), (R, W * 0.36), (R * 0.95, W * 0.48), (R * 0.8, W * 0.5), (inner, W * 0.45)]
    seg = 22 if lod else 40
    bm = bmesh.new()
    rings = []
    for i in range(seg):
        a = 2 * math.pi * i / seg
        rings.append([bm.verts.new((math.cos(a) * r, y, math.sin(a) * r)) for r, y in prof])
    for i in range(seg):
        j = (i + 1) % seg
        for k in range(len(prof) - 1):
            bm.faces.new((rings[i][k], rings[j][k], rings[j][k + 1], rings[i][k + 1]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    for f in bm.faces:
        c = f.calc_center_median()
        if f.normal.dot(Vector((c.x, 0, c.z)).normalized()) < 0 and abs(c.y) < W * 0.45:
            f.normal_flip()
    me = bpy.data.meshes.new(name + 'Tyre')
    bm.to_mesh(me)
    bm.free()
    t = link(name + 'Tyre', me, M['rubber'], part=False)
    parts.append(t)
    nl = lugs // 2 if lod else lugs
    for i in range(nl):
        a = 2 * math.pi * i / nl
        for row, y in enumerate((-W * 0.22, W * 0.22)):
            aa = a + (math.pi / nl if row else 0)
            ob = box('Lug', (0.06 if not lod else 0.09, W * 0.36, 0.1), (math.cos(aa) * (R + 0.005), y, math.sin(aa) * (R + 0.005)), M['rubber'], bev=0 if lod else 0.012, seg=1, rot=(0, -aa, 0))
            PARTS.remove(ob); parts.append(ob)
    def add(o):
        if o in PARTS: PARTS.remove(o)
        parts.append(o); return o
    add(cyl('Barrel', inner + 0.01, W * 0.8, (0, 0, 0), M['black'], axis='Y', verts=16 if lod else 32))
    add(cyl('Face', inner * 0.96, 0.025, (0, W * 0.32, 0), M['rim'], axis='Y', verts=16 if lod else 32, bev=0 if lod else 0.006))
    bpy.ops.mesh.primitive_torus_add(major_radius=inner * 0.98, minor_radius=0.02, major_segments=16 if lod else 32, minor_segments=4 if lod else 6, location=(0, W * 0.4, 0), rotation=(math.pi / 2, 0, 0))
    b = bpy.context.active_object; b.data.materials.append(M['bead']); add(b)
    for i in range(5):
        a = 2 * math.pi * i / 5
        add(box('Spoke', (inner * 0.8, 0.04, 0.05), (math.cos(a) * inner * 0.45, W * 0.36, math.sin(a) * inner * 0.45), M['rim'], bev=0 if lod else 0.012, rot=(0, -a, 0)))
    add(cyl('Hub', 0.06, 0.07, (0, W * 0.4, 0), M['rim'], axis='Y', verts=8 if lod else 16, bev=0 if lod else 0.01))
    add(cyl('Inner', inner, 0.01, (0, -W * 0.35, 0), M['black'], axis='Y', verts=12 if lod else 24))
    for o in parts:
        apply_mods(o)
    bpy.ops.object.select_all(action='DESELECT')
    for o in parts:
        o.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.ops.object.join()
    w = bpy.context.active_object
    w.name = name
    w.data.shade_smooth()
    w.data.set_sharp_from_angle(angle=math.radians(50))
    return w


# whip antenna with flag on the rear cage (separate so the game can sway it)
def build_whip():
    pole = cyl('Pole', 0.012, 1.3, (0, 0, 0.65), M['tube'], axis=None, verts=8)
    bm = bmesh.new()
    a = bm.verts.new((0, 0, 1.3)); b = bm.verts.new((0, 0, 1.05)); c = bm.verts.new((-0.42, 0, 1.2))
    bm.faces.new((a, b, c))
    a2 = bm.verts.new((0, 0.004, 1.3)); b2 = bm.verts.new((0, 0.004, 1.05)); c2 = bm.verts.new((-0.42, 0.004, 1.2))
    bm.faces.new((c2, b2, a2))
    me = bpy.data.meshes.new('FlagMesh')
    bm.to_mesh(me)
    bm.free()
    flag = link('Flag', me, M['flag'])
    for ob in (pole, flag):
        apply_mods(ob)
        if ob in PARTS: PARTS.remove(ob)
    bpy.ops.object.select_all(action='DESELECT')
    pole.select_set(True); flag.select_set(True)
    bpy.context.view_layer.objects.active = pole
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.ops.object.join()
    w = bpy.context.active_object
    w.name = 'Whip'
    w.data.shade_smooth()
    w.location = (-1.92, 0.55, 1.06)
    return w


# ------------------------------------------------------------------ finalize
for o in list(PARTS):
    apply_mods(o)
bpy.ops.object.select_all(action='DESELECT')
for o in PARTS:
    o.select_set(True)
bpy.context.view_layer.objects.active = PARTS[0]
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
bpy.ops.object.join()
body = bpy.context.active_object
body.name = 'Body'
body.data.shade_smooth()
body.data.set_sharp_from_angle(angle=math.radians(38))
PARTS.clear()
wf = wheel('WheelF', FR, 0.26, 16)
wr = wheel('WheelR', RR, 0.4, 20)
wfl = wheel('WheelFLOD', FR, 0.26, 16, lod=True)
wrl = wheel('WheelRLOD', RR, 0.4, 20, lod=True)
whip = build_whip()

def empty(name, loc):
    e = bpy.data.objects.new(name, None)
    COLL.objects.link(e)
    e.location = loc
    return e
markers = [empty('ExhaustL', (-2.4, 0.06, 1.02)), empty('ExhaustR', (-2.4, -0.06, 1.02)), empty('RoofLights', (0.16, 0, 1.875)),
           empty('HeadL', (2.13, 0.4, 0.79)), empty('HeadR', (2.13, -0.4, 0.79)), empty('TailL', (-2.08, 0.42, 0.98)), empty('TailR', (-2.08, -0.42, 0.98)),
           empty('WheelFL', (FX, FY, FR)), empty('WheelRL', (RX, RY, RR))]

# AO bake
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = SAMPLES
scene.world = bpy.data.worlds.new('W')
scene.world.light_settings.distance = 0.6
temps = []
for (x, y, w) in [(FX, FY, wf), (FX, -FY, wf), (RX, RY, wr), (RX, -RY, wr)]:
    t = w.copy(); t.data = w.data.copy(); COLL.objects.link(t)
    t.location = (x, y, FR if w is wf else RR)
    if y < 0: t.scale = (1, -1, 1)
    temps.append(t)
bpy.ops.mesh.primitive_plane_add(size=12, location=(0, 0, 0))
temps.append(bpy.context.active_object)

def bake(objs):
    for o in objs:
        me = o.data
        if 'AO' not in me.color_attributes:
            me.color_attributes.new('AO', 'FLOAT_COLOR', 'CORNER')
        me.color_attributes.active_color = me.color_attributes['AO']
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.bake(type='AO', target='VERTEX_COLORS', use_clear=True)
    for o in objs:
        for d in o.data.color_attributes['AO'].data:
            v = 0.18 + 0.82 * (d.color[0] ** 0.85)
            d.color = (v, v, v, 1.0)

for k, o in enumerate([wf, wr, wfl, wrl]):
    o.location = (0, 100 + 10 * k, 0)  # keep the wheel templates out of the body bake
bake([body])
for t in temps:
    bpy.data.objects.remove(t)
keep = whip.location.copy()
for k, o in enumerate([wf, wr, wfl, wrl, whip]):
    o.location = (0, 40 + 10 * k, 0); bake([o])
for o in (wf, wr, wfl, wrl):
    o.location = (0, 0, 0)
whip.location = keep

bpy.ops.object.select_all(action='DESELECT')
for o in [body, wf, wr, wfl, wrl, whip] + markers:
    o.select_set(True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
                          export_vertex_color='ACTIVE', export_materials='EXPORT', export_image_format='NONE',
                          export_animations=False, export_cameras=False, export_lights=False,
                          export_meshopt_compression_enable=True)
tri = lambda o: sum(len(p.vertices) - 2 for p in o.data.polygons)
print('EXPORTED', OUT, 'body', tri(body), 'wf', tri(wf), 'wr', tri(wr), 'lod', tri(wfl), tri(wrl), 'whip', tri(whip))

if PREVIEW:
    for k, o in enumerate((wfl, wrl)):
        o.location = (0, 200 + 10 * k, 0)
    for (x, y, w) in [(FX, FY, wf), (FX, -FY, wf), (RX, RY, wr), (RX, -RY, wr)]:
        t = w.copy(); COLL.objects.link(t)
        t.location = (x, y, FR if w is wf else RR)
        if y < 0: t.scale = (1, -1, 1)
    wf.location = (0, 220, 0); wr.location = (0, 230, 0)
    M['paint'].node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.05, 0.2, 0.75, 1)
    bpy.ops.mesh.primitive_plane_add(size=40)
    g = bpy.context.active_object; gm = material('Ground', (0.32, 0.18, 0.1), 0, 0.9); g.data.materials.append(gm)
    sun = bpy.data.lights.new('Sun', 'SUN'); sun.energy = 4
    so = bpy.data.objects.new('Sun', sun); COLL.objects.link(so); so.rotation_euler = (math.radians(50), 0, math.radians(140))
    scene.world.use_nodes = True
    scene.world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.55, 0.65, 0.8, 1)
    cam = bpy.data.cameras.new('C'); cam.lens = 50
    co = bpy.data.objects.new('C', cam); COLL.objects.link(co)
    for pos, tag in [((6.5, 5.0, 3.0), 'a'), ((-6.0, 5.5, 4.5), 'b')]:
        co.location = pos
        co.rotation_euler = (Vector((0, 0, 0.8)) - Vector(pos)).to_track_quat('-Z', 'Y').to_euler()
        scene.camera = co
        scene.render.resolution_x, scene.render.resolution_y = 960, 600
        scene.cycles.samples = 48
        scene.render.filepath = PREVIEW.replace('.png', f'_{tag}.png')
        bpy.ops.render.render(write_still=True)
