# Off-road race truck (stadium / trophy truck) for Super Off Road Remastered.
# Builds the model procedurally, bakes ambient occlusion into vertex colours and
# exports a GLB with: Body (all body parts), Wheel (one wheel at the origin),
# Whip (antenna + flag, origin at its base) and marker empties.
#
# Run: blender -b --factory-startup --python tools/blender/truck.py -- out.glb [--preview out.png] [--samples N]
# Axes: Blender +X = truck front, +Y = truck left, +Z = up (exported as glTF +Y up).

import bpy, bmesh, math, sys
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = argv[0] if argv and not argv[0].startswith('--') else '/tmp/truck.glb'
PREVIEW = argv[argv.index('--preview') + 1] if '--preview' in argv else None
SAMPLES = int(argv[argv.index('--samples') + 1]) if '--samples' in argv else 48
NOBAKE = '--nobake' in argv

WHEEL_X, WHEEL_Y, WHEEL_R, WHEEL_W = 1.42, 0.98, 0.48, 0.40

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

# ------------------------------------------------------------------ materials
def material(name, color, metallic=0.0, roughness=0.5, coat=0.0, coat_rough=0.05, emission=None, strength=0.0, spec=0.5):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Metallic'].default_value = metallic
    b.inputs['Roughness'].default_value = roughness
    b.inputs['Specular IOR Level'].default_value = spec
    if coat:
        b.inputs['Coat Weight'].default_value = coat
        b.inputs['Coat Roughness'].default_value = coat_rough
    if emission:
        b.inputs['Emission Color'].default_value = (*emission, 1)
        b.inputs['Emission Strength'].default_value = strength
    return m

M = {
    'paint': material('Paint', (0.80, 0.80, 0.80), 0.25, 0.32, coat=1.0, coat_rough=0.05),
    'accent': material('Accent', (0.92, 0.92, 0.92), 0.1, 0.35, coat=1.0, coat_rough=0.06),
    'black': material('Black', (0.022, 0.022, 0.025), 0.35, 0.5),
    'tube': material('Tube', (0.035, 0.035, 0.038), 0.7, 0.32),
    'chrome': material('Chrome', (0.92, 0.92, 0.94), 1.0, 0.1),
    'glass': material('Glass', (0.012, 0.016, 0.024), 0.0, 0.04, spec=0.8),
    'rubber': material('Rubber', (0.022, 0.021, 0.02), 0.0, 0.84),
    'rim': material('Rim', (0.62, 0.62, 0.66), 1.0, 0.24),
    'bead': material('Beadlock', (0.78, 0.52, 0.16), 1.0, 0.28),
    'light': material('Light', (1.0, 1.0, 1.0), 0.0, 0.08, emission=(1.0, 0.95, 0.82), strength=2.5),
    'lens': material('Lens', (0.9, 0.9, 0.92), 0.0, 0.05, emission=(1.0, 0.96, 0.85), strength=1.2),
    'tail': material('TailLight', (0.5, 0.02, 0.02), 0.0, 0.1, emission=(1.0, 0.06, 0.03), strength=1.0),
    'decal': material('Decal', (0.92, 0.92, 0.92), 0.0, 0.32, coat=1.0, coat_rough=0.05),
    'decal_roof': material('DecalRoof', (0.92, 0.92, 0.92), 0.0, 0.32, coat=1.0, coat_rough=0.05),
    'helmet': material('Helmet', (0.9, 0.9, 0.9), 0.1, 0.22, coat=1.0),
    'suit': material('Suit', (0.12, 0.12, 0.14), 0.0, 0.7),
    'flag': material('Flag', (1.0, 0.32, 0.02), 0.0, 0.6, emission=(1.0, 0.25, 0.0), strength=0.15),
    'shock': material('Shock', (0.85, 0.62, 0.2), 1.0, 0.22),
    'net': material('Net', (0.03, 0.03, 0.03), 0.0, 0.8),
}

# ------------------------------------------------------------------ helpers
COLL = bpy.context.collection
PARTS = []

def link(name, me, mat=None, part=True):
    ob = bpy.data.objects.new(name, me)
    COLL.objects.link(ob)
    if mat is not None:
        if isinstance(mat, (list, tuple)):
            for m in mat: me.materials.append(m)
        else:
            me.materials.append(mat)
    if part: PARTS.append(ob)
    return ob

def mod(ob, kind, **kw):
    m = ob.modifiers.new(kind.lower(), kind)
    for k, v in kw.items(): setattr(m, k, v)
    return m

def apply_mods(ob):
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    ob.modifiers.clear()
    old = ob.data
    ob.data = me
    bpy.data.meshes.remove(old)

def bevel(ob, width, seg=3, angle=35):
    mod(ob, 'BEVEL', width=width, segments=seg, limit_method='ANGLE', angle_limit=math.radians(angle), harden_normals=False)

def smooth(ob, angle=40):
    ob.data.shade_smooth()
    ob.data.set_sharp_from_angle(angle=math.radians(angle))

def prism(name, prof, y0, y1, mat, bev=0.0, seg=3, taper=None, center=None):
    """Extrude an XZ outline (list of (x,z), counter-clockwise seen from +Y) from y0 to y1.
    taper: scale of the y1 face about `center` (x,z)."""
    bm = bmesh.new()
    v0 = [bm.verts.new((x, y0, z)) for x, z in prof]
    v1 = [bm.verts.new((x, y1, z)) for x, z in prof]
    if taper and center:
        cx, cz = center
        for v in v1:
            v.co.x = cx + (v.co.x - cx) * taper
            v.co.z = cz + (v.co.z - cz) * taper
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
    if bev: bevel(ob, bev, seg)
    return ob

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
    if bev: bevel(ob, bev, seg, 30)
    return ob

def cyl(name, r, depth, loc, mat, axis='X', verts=24, bev=0.0, r2=None):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=verts, radius1=r, radius2=r if r2 is None else r2, depth=depth)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = link(name, me, mat)
    ob.location = loc
    if axis == 'X': ob.rotation_euler = (0, math.pi / 2, 0)
    elif axis == 'Y': ob.rotation_euler = (math.pi / 2, 0, 0)
    if bev: bevel(ob, bev, 2, 30)
    return ob

def tube(name, pts, r, mat, res=10):
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
    # convert to mesh
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    bpy.data.objects.remove(ob)
    me.materials.clear()
    return link(name, me, mat)

def bend_tube(name, pts, r, mat, rad=0.08, seg=4):
    """polyline tube with rounded bends"""
    out = [Vector(pts[0])]
    for i in range(1, len(pts) - 1):
        a, b, c = Vector(pts[i - 1]), Vector(pts[i]), Vector(pts[i + 1])
        d1 = (b - a).normalized(); d2 = (c - b).normalized()
        t = min(rad, (b - a).length * 0.45, (c - b).length * 0.45)
        p0, p1 = b - d1 * t, b + d2 * t
        for k in range(seg + 1):
            u = k / seg
            q = (1 - u) ** 2 * p0 + 2 * (1 - u) * u * b + u * u * p1
            out.append(q)
    out.append(Vector(pts[-1]))
    return tube(name, [tuple(p) for p in out], r, mat)

def arch_profile(cx, cz, r, x0, x1, zb, top, steps=20):
    """Fender outline (XZ): rectangle-ish top hugging the wheel, cut by a wheel well arch."""
    # well arch from front-bottom to rear-bottom over the top
    dz = zb - cz
    dx = math.sqrt(max(0.0, r * r - dz * dz))
    a_front = math.atan2(dz, dx)
    a_rear = math.pi - a_front
    arch = []
    for i in range(steps + 1):
        a = a_front + (a_rear - a_front) * i / steps
        arch.append((cx + math.cos(a) * r, cz + math.sin(a) * r))
    # outline: bottom front corner -> arch -> bottom rear corner -> up the rear -> top -> down the front
    pts = [(x1, zb)] + arch + [(x0, zb)] + top
    return pts

# ------------------------------------------------------------------ body
Y_CORE = 0.64

# nose + hood (core between the fenders)
prism('Hood', [(0.58, 0.64), (2.04, 0.64), (2.17, 0.76), (2.19, 0.92), (2.12, 1.03), (1.6, 1.085), (0.58, 1.15)],
      -Y_CORE, Y_CORE, M['paint'], bev=0.045, seg=3)
# power bulge on the hood
prism('HoodBulge', [(0.66, 1.1), (1.85, 1.06), (1.95, 1.08), (1.75, 1.13), (0.66, 1.2)], -0.34, 0.34, M['paint'], bev=0.035, seg=3)
# hood scoop / vent (dark)
box('Scoop', (0.34, 0.42, 0.06), (1.25, 0, 1.165), M['black'], bev=0.02, rot=(0, math.radians(-2.5), 0))

for side in (1, -1):
    y_in, y_out = 0.6 * side, 1.15 * side
    # front fender flare: hugs the wheel, rises above the hood line
    top = [(0.70, 0.80), (0.74, 1.05), (0.95, 1.20), (1.25, 1.27), (1.62, 1.26), (1.95, 1.17), (2.12, 1.0), (2.16, 0.84)]
    prof = arch_profile(WHEEL_X, WHEEL_R, 0.63, 0.72, 2.12, 0.66, top)
    prof = [(x, z) for (x, z) in prof]
    # outline must be counter-clockwise seen from +Y: arch_profile goes front->rear along the bottom then back over the top
    ob = prism('FenderF', prof, min(y_in, y_out), max(y_in, y_out), M['paint'], bev=0.04, seg=3,
               taper=None)
    # slight outward taper of the flare lip
    for v in ob.data.vertices:
        if abs(v.co.y) > 1.0:
            v.co.x = WHEEL_X + (v.co.x - WHEEL_X) * 0.97
            v.co.z = WHEEL_R + (v.co.z - WHEEL_R) * 0.97 + 0.01
    # rear fender flare
    top_r = [(-2.16, 0.84), (-2.14, 1.04), (-1.92, 1.2), (-1.55, 1.27), (-1.15, 1.26), (-0.86, 1.18), (-0.72, 1.02), (-0.70, 0.84)]
    prof_r = arch_profile(-WHEEL_X, WHEEL_R, 0.63, -2.14, -0.72, 0.66, top_r)
    ob = prism('FenderR', prof_r, min(0.84 * side, 1.15 * side), max(0.84 * side, 1.15 * side), M['paint'], bev=0.04, seg=3)
    for v in ob.data.vertices:
        if abs(v.co.y) > 1.0:
            v.co.x = -WHEEL_X + (v.co.x + WHEEL_X) * 0.97
            v.co.z = WHEEL_R + (v.co.z - WHEEL_R) * 0.97 + 0.01

# cab (doors) and greenhouse
prism('Cab', [(-0.66, 0.66), (0.60, 0.66), (0.62, 1.17), (-0.66, 1.22)], -0.88, 0.88, M['paint'], bev=0.045, seg=3)
# side skirts / rock sliders between the wheels (dark)
for side in (1, -1):
    box('Slider', (1.25, 0.12, 0.12), (0.0, 0.86 * side, 0.66), M['tube'], bev=0.03)

def greenhouse():
    bm = bmesh.new()
    zb, zt = 1.205, 1.76
    b = [(-0.64, -0.86), (0.60, -0.86), (0.60, 0.86), (-0.64, 0.86)]
    t = [(-0.56, -0.70), (-0.02, -0.70), (-0.02, 0.70), (-0.56, 0.70)]
    vb = [bm.verts.new((x, y, zb)) for x, y in b]
    vt = [bm.verts.new((x, y, zt)) for x, y in t]
    bm.faces.new(vb[::-1])
    top = bm.faces.new(vt)
    sides = []
    for i in range(4):
        j = (i + 1) % 4
        sides.append(bm.faces.new((vb[i], vb[j], vt[j], vt[i])))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    # windows: inset the four side faces, push the glass in a little
    res = bmesh.ops.inset_individual(bm, faces=sides, thickness=0.075, depth=-0.018)
    for f in sides:
        f.material_index = 1
    me = bpy.data.meshes.new('Greenhouse')
    bm.to_mesh(me)
    bm.free()
    ob = link('Greenhouse', me, [M['paint'], M['glass']])
    bevel(ob, 0.02, 2, 40)
    return ob
greenhouse()
# roof spoiler / lip
box('RoofLip', (0.18, 1.38, 0.04), (-0.58, 0, 1.75), M['paint'], bev=0.015)

# bed: floor, walls with wheel arches, tub
box('BedFloor', (1.52, 1.66, 0.06), (-1.42, 0, 0.84), M['black'], bev=0.01)
for side in (1, -1):
    prof = arch_profile(-WHEEL_X, WHEEL_R, 0.63, -2.18, -0.66, 0.72, [(-0.66, 1.25), (-2.18, 1.25)][::-1])
    prism('BedWall', prof, min(0.78 * side, 0.86 * side), max(0.78 * side, 0.86 * side), M['paint'], bev=0.02, seg=2)
    # bed rail cap
    box('BedRail', (1.52, 0.11, 0.04), (-1.42, 0.82 * side, 1.265), M['black'], bev=0.012)
# bulkhead behind the cab and rear panel
box('Bulkhead', (0.05, 1.62, 0.42), (-0.68, 0, 1.03), M['black'], bev=0.01)
box('RearPanel', (0.05, 1.62, 0.22), (-2.17, 0, 0.88), M['paint'], bev=0.015)

# fuel cell + spare tyre in the bed
box('FuelCell', (0.42, 1.0, 0.3), (-1.95, 0, 1.0), M['black'], bev=0.04)
# shocks: big bypass shocks from the bed to the cage
for side in (1, -1):
    for dx in (-0.12, 0.12):
        p0 = Vector((-1.42 + dx, 0.62 * side, 0.9))
        p1 = Vector((-1.25 + dx * 0.5, 0.58 * side, 1.62))
        d = p1 - p0
        c = cyl('Shock', 0.055, d.length, (p0 + p1) / 2, M['shock'], axis=None, verts=14)
        c.rotation_mode = 'QUATERNION'
        c.rotation_quaternion = d.to_track_quat('Z', 'Y')

# ------------------------------------------------------------------ front end details
box('Grille', (0.05, 0.62, 0.17), (2.19, 0, 0.86), M['black'], bev=0.012)
for k in range(4):
    box('GrilleBar', (0.02, 0.6, 0.018), (2.215, 0, 0.80 + k * 0.042), M['chrome'], bev=0.006)
for side in (1, -1):
    box('Headlight', (0.04, 0.2, 0.12), (2.19, 0.47 * side, 0.89), M['light'], bev=0.015)
    box('HeadBezel', (0.03, 0.24, 0.16), (2.172, 0.47 * side, 0.89), M['black'], bev=0.012)
# skid plate and tube bumper
prism('Skid', [(1.7, 0.42), (2.3, 0.52), (2.32, 0.6), (1.75, 0.62)], -0.62, 0.62, M['black'], bev=0.02)
bend_tube('BumperF', [(2.05, -0.92, 0.66), (2.32, -0.7, 0.66), (2.38, 0.0, 0.66), (2.32, 0.7, 0.66), (2.05, 0.92, 0.66)], 0.045, M['tube'], rad=0.15)
for side in (1, -1):
    bend_tube('BumperUp', [(2.34, 0.42 * side, 0.66), (2.32, 0.42 * side, 0.92), (2.18, 0.42 * side, 1.02)], 0.035, M['tube'], rad=0.08)
# KC lights on the bumper
for side in (1, -1):
    cyl('BumperLight', 0.085, 0.09, (2.4, 0.28 * side, 0.82), M['black'], axis='X', verts=20)
    cyl('BumperLens', 0.07, 0.012, (2.447, 0.28 * side, 0.82), M['lens'], axis='X', verts=20)

# roof light bar
bend_tube('LightBar', [(-0.04, -0.74, 1.77), (0.02, -0.72, 1.91), (0.02, 0.72, 1.91), (-0.04, 0.74, 1.77)], 0.03, M['tube'], rad=0.06)
for k, y in enumerate((-0.51, -0.17, 0.17, 0.51)):
    cyl('RoofLight', 0.105, 0.11, (0.07, y, 1.93), M['black'], axis='X', verts=20)
    cyl('RoofLens', 0.088, 0.014, (0.13, y, 1.93), M['lens'], axis='X', verts=20)

# ------------------------------------------------------------------ cage, rear end
for side in (1, -1):
    bend_tube('CageSide', [(-0.52, 0.66 * side, 1.75), (-1.15, 0.7 * side, 1.53), (-2.05, 0.74 * side, 1.27)], 0.04, M['tube'], rad=0.2)
    bend_tube('CageHoop', [(-0.62, 0.8 * side, 0.86), (-0.6, 0.72 * side, 1.5), (-0.54, 0.66 * side, 1.74)], 0.04, M['tube'], rad=0.15)
    bend_tube('CageRear', [(-2.05, 0.74 * side, 1.27), (-2.2, 0.74 * side, 0.95), (-2.32, 0.6 * side, 0.68)], 0.04, M['tube'], rad=0.12)
bend_tube('CageCross', [(-2.05, -0.74, 1.27), (-2.05, 0.74, 1.27)], 0.04, M['tube'])
bend_tube('CageX', [(-1.2, -0.7, 1.54), (-1.2, 0.7, 1.54)], 0.035, M['tube'])
bend_tube('CageDiag', [(-1.2, 0.7, 1.54), (-2.05, -0.74, 1.27)], 0.032, M['tube'])
bend_tube('BumperR', [(-2.1, -0.95, 0.66), (-2.34, -0.7, 0.66), (-2.36, 0.0, 0.66), (-2.34, 0.7, 0.66), (-2.1, 0.95, 0.66)], 0.045, M['tube'], rad=0.15)
for side in (1, -1):
    box('TailLight', (0.03, 0.12, 0.16), (-2.2, 0.72 * side, 1.08), M['tail'], bev=0.01)
    # exhausts
    cyl('Exhaust', 0.055, 0.32, (-2.26, 0.34 * side, 0.7), M['chrome'], axis='X', verts=16)
    cyl('ExhaustIn', 0.04, 0.33, (-2.265, 0.34 * side, 0.7), M['black'], axis='X', verts=16)
    # mud flaps
    box('MudFlap', (0.03, 0.42, 0.42), (-2.05, 0.98 * side, 0.46), M['rubber'], bev=0.008)
    box('MudFlapF', (0.03, 0.36, 0.3), (0.82, 0.98 * side, 0.54), M['rubber'], bev=0.008)
    # mirrors
    box('Mirror', (0.08, 0.14, 0.1), (0.5, 0.97 * side, 1.3), M['black'], bev=0.02)

# accents: hood stripes and lower side stripe
for side in (1, -1):
    prism('HoodStripe', [(0.6, 1.152), (2.1, 1.036), (2.1, 1.044), (0.6, 1.16)], 0.42 * side - 0.07, 0.42 * side + 0.07, M['accent'])
    box('SideStripe', (1.3, 0.012, 0.08), (-0.02, 0.888 * side, 0.74), M['accent'])
    box('BedStripe', (1.5, 0.012, 0.08), (-1.42, 0.866 * side, 1.15), M['accent'])

# number plates (UV 0..1 for the in-game number texture)
def plate(name, center, size, normal_axis, flip, mat):
    cx, cy, cz = center
    w, h = size
    bm = bmesh.new()
    if normal_axis == 'Y':
        s = 1 if not flip else -1
        vs = [bm.verts.new((cx - w / 2 * s, cy, cz - h / 2)), bm.verts.new((cx + w / 2 * s, cy, cz - h / 2)),
              bm.verts.new((cx + w / 2 * s, cy, cz + h / 2)), bm.verts.new((cx - w / 2 * s, cy, cz + h / 2))]
    else:
        vs = [bm.verts.new((cx - w / 2, cy + h / 2, cz)), bm.verts.new((cx - w / 2, cy - h / 2, cz)),
              bm.verts.new((cx + w / 2, cy - h / 2, cz)), bm.verts.new((cx + w / 2, cy + h / 2, cz))]
    f = bm.faces.new(vs)
    uv = bm.loops.layers.uv.new('UVMap')
    for l, (u, v) in zip(f.loops, [(0, 0), (1, 0), (1, 1), (0, 1)]):
        l[uv].uv = (u, v)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = link(name, me, mat)
    # face normal must point outwards
    n = ob.data.polygons[0].normal
    want = {'Y': Vector((0, 1 if cy > 0 else -1, 0)), 'Z': Vector((0, 0, 1))}[normal_axis]
    if n.dot(want) < 0:
        ob.data.flip_normals()
    return ob

plate('DoorNumL', (-0.02, 0.892, 0.96), (0.78, 0.40), 'Y', True, M['decal'])
plate('DoorNumR', (-0.02, -0.892, 0.96), (0.78, 0.40), 'Y', False, M['decal'])
plate('RoofNum', (-0.29, 0.0, 1.766), (0.5, 1.2), 'Z', False, M['decal_roof'])

# driver
bpy.ops.mesh.primitive_uv_sphere_add(segments=20, ring_count=12, radius=0.15, location=(-0.08, 0.36, 1.47))
helmet = bpy.context.active_object
helmet.name = 'Helmet'
helmet.data.materials.append(M['helmet'])
PARTS.append(helmet)
box('Torso', (0.32, 0.44, 0.34), (-0.12, 0.36, 1.2), M['suit'], bev=0.06)
box('Seat', (0.12, 0.5, 0.6), (-0.32, 0.36, 1.2), M['black'], bev=0.03)
box('Dash', (0.2, 1.5, 0.12), (0.45, 0, 1.24), M['black'], bev=0.02)

# underbody so nothing looks hollow from low angles
box('Underbody', (4.1, 1.24, 0.06), (0.0, 0, 0.64), M['black'])
# suspension arms (front) and axle (rear) visible through the wheel wells
for side in (1, -1):
    bend_tube('ArmF', [(1.2, 0.55 * side, 0.6), (WHEEL_X, 0.85 * side, 0.5)], 0.045, M['tube'])
    bend_tube('ArmF2', [(1.65, 0.55 * side, 0.6), (WHEEL_X, 0.85 * side, 0.5)], 0.045, M['tube'])
    cyl('ShockF', 0.05, 0.5, (WHEEL_X - 0.05, 0.72 * side, 0.82), M['shock'], axis=None, verts=12)
cyl('Axle', 0.07, 1.75, (-WHEEL_X, 0, WHEEL_R), M['tube'], axis='Y', verts=14)
box('Diff', (0.3, 0.32, 0.3), (-WHEEL_X, 0, WHEEL_R), M['tube'], bev=0.06)

# ------------------------------------------------------------------ wheel
def build_wheel(lod=False):
    parts = []
    # tyre carcass: revolve a rounded profile around Y (r, y)
    prof = [(0.255, -0.17), (0.30, -0.195), (0.40, -0.2), (0.445, -0.19), (0.465, -0.15), (0.47, -0.08),
            (0.47, 0.08), (0.465, 0.15), (0.445, 0.19), (0.40, 0.2), (0.30, 0.195), (0.255, 0.17)]
    seg = 32 if lod else 56
    if lod:
        prof = [prof[0], prof[2], prof[4], prof[5], prof[6], prof[7], prof[9], prof[11]]
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
    # make normals point outwards (away from the axle)
    for f in bm.faces:
        c = f.calc_center_median()
        radial = Vector((c.x, 0, c.z)).normalized()
        if f.normal.dot(radial) < 0 and abs(c.y) < 0.19:
            f.normal_flip()
    me = bpy.data.meshes.new('Tyre')
    bm.to_mesh(me)
    bm.free()
    tyre = link('Tyre', me, M['rubber'], part=False)
    smooth(tyre, 50)
    parts.append(tyre)
    # tread blocks: two staggered rows + shoulder lugs
    nb = 14 if lod else 22
    for row, (y, w, sh) in enumerate([(-0.085, 0.13, 0.0), (0.085, 0.13, 0.5)]):
        for i in range(nb):
            a = 2 * math.pi * (i + sh) / nb
            r = 0.478
            ob = box('Lug', (0.075, w, 0.13 if not lod else 0.18), (math.cos(a) * r, y, math.sin(a) * r), M['rubber'], bev=0 if lod else 0.016, seg=1, rot=(0, -a, 0))
            PARTS.remove(ob)
            parts.append(ob)
    for side in ((-1, 1) if not lod else ()):
        for i in range(nb):
            a = 2 * math.pi * (i + (0.25 if side > 0 else 0.75)) / nb
            r = 0.455
            ob = box('Shoulder', (0.06, 0.07, 0.1), (math.cos(a) * r, 0.175 * side, math.sin(a) * r), M['rubber'], bev=0.012, seg=1, rot=(0, -a, 0))
            PARTS.remove(ob)
            parts.append(ob)
    # rim: barrel, face, beadlock ring with bolts, spokes, hub
    def add(ob):
        if ob in PARTS: PARTS.remove(ob)
        parts.append(ob)
        return ob
    add(cyl('Barrel', 0.245, 0.36, (0, 0, 0), M['black'], axis='Y', verts=40))
    add(cyl('RimFace', 0.235, 0.03, (0, 0.13, 0), M['rim'], axis='Y', verts=40, bev=0.008))
    bpy.ops.mesh.primitive_torus_add(major_radius=0.248, minor_radius=0.024, major_segments=36, minor_segments=6,
                                     location=(0, 0.16, 0), rotation=(math.pi / 2, 0, 0))
    bead = bpy.context.active_object
    bead.name = 'BeadRing'
    bead.data.materials.append(M['bead'])
    bead.scale = (1, 1, 0.75)
    add(bead)
    for i in range(0 if lod else 12):
        a = 2 * math.pi * i / 12
        add(cyl('Bolt', 0.012, 0.025, (math.cos(a) * 0.25, 0.185, math.sin(a) * 0.25), M['chrome'], axis='Y', verts=6))
    for i in range(6):
        a = 2 * math.pi * i / 6
        ob = add(box('Spoke', (0.2, 0.05, 0.055), (math.cos(a) * 0.12, 0.155, math.sin(a) * 0.12), M['rim'], bev=0.015, rot=(0, -a, 0)))
    add(cyl('Hub', 0.075, 0.07, (0, 0.17, 0), M['rim'], axis='Y', verts=20, bev=0.01))
    add(cyl('HubCap', 0.045, 0.03, (0, 0.205, 0), M['bead'], axis='Y', verts=16, bev=0.006))
    # dark inner face so the wheel looks solid from inside
    add(cyl('Inner', 0.25, 0.01, (0, -0.15, 0), M['black'], axis='Y', verts=32))
    for ob in parts:
        apply_mods(ob)
    bpy.ops.object.select_all(action='DESELECT')
    for ob in parts: ob.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.ops.object.join()
    w = bpy.context.active_object
    w.name = 'WheelLOD' if lod else 'Wheel'
    return w

# ------------------------------------------------------------------ finalize body
for ob in list(PARTS):
    apply_mods(ob)
bpy.ops.object.select_all(action='DESELECT')
for ob in PARTS:
    ob.select_set(True)
bpy.context.view_layer.objects.active = PARTS[0]
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
bpy.ops.object.join()
body = bpy.context.active_object
body.name = 'Body'
smooth(body, 38)
mod(body, 'WEIGHTED_NORMAL', keep_sharp=True)
apply_mods(body)
PARTS.clear()

wheel = build_wheel()
smooth(wheel, 50)
wheel_lod = build_wheel(lod=True)
smooth(wheel_lod, 50)

# whip antenna with flag (separate so the game can sway it)
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
    w.location = (-2.02, 0.7, 1.27)
    return w
whip = build_whip()
smooth(whip, 60)

# marker empties
def empty(name, loc):
    e = bpy.data.objects.new(name, None)
    COLL.objects.link(e)
    e.location = loc
    return e
markers = [empty('ExhaustL', (-2.43, 0.34, 0.7)), empty('ExhaustR', (-2.43, -0.34, 0.7)),
           empty('HeadL', (2.2, 0.47, 0.89)), empty('HeadR', (2.2, -0.47, 0.89)),
           empty('RoofLights', (0.14, 0, 1.93)), empty('TailL', (-2.22, 0.72, 1.08)), empty('TailR', (-2.22, -0.72, 1.08))]

# ------------------------------------------------------------------ AO bake into vertex colours
def bake_ao(objs, extra=()):
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = SAMPLES
    if not scene.world:
        scene.world = bpy.data.worlds.new('World')
    scene.world.light_settings.distance = 0.6
    scene.render.bake.target = 'VERTEX_COLORS'
    scene.render.bake.use_clear = True
    for ob in objs:
        me = ob.data
        if 'AO' not in me.color_attributes:
            me.color_attributes.new('AO', 'FLOAT_COLOR', 'CORNER')
        me.color_attributes.active_color = me.color_attributes['AO']
    bpy.ops.object.select_all(action='DESELECT')
    for ob in objs: ob.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.bake(type='AO', target='VERTEX_COLORS', use_clear=True)
    # soften: keep paint from turning muddy
    for ob in objs:
        ca = ob.data.color_attributes['AO']
        for d in ca.data:
            v = d.color[0]
            v = 0.18 + 0.82 * (v ** 0.85)
            d.color = (v, v, v, 1.0)

if not NOBAKE:
    # temporary wheels + ground to occlude the body correctly
    temps = []
    for x in (WHEEL_X, -WHEEL_X):
        for y in (WHEEL_Y, -WHEEL_Y):
            t = wheel.copy(); t.data = wheel.data.copy()
            COLL.objects.link(t)
            t.location = (x, y, WHEEL_R)
            if y < 0: t.scale = (1, -1, 1)
            temps.append(t)
    bpy.ops.mesh.primitive_plane_add(size=12, location=(0, 0, 0))
    ground = bpy.context.active_object
    temps.append(ground)
    bake_ao([body])
    for t in temps:
        bpy.data.objects.remove(t)
    bake_ao([whip])
    # wheel alone, away from the body
    wheel.location = (0, 40, 0)
    bake_ao([wheel])
    wheel.location = (0, 0, 0)
    wheel_lod.location = (0, -40, 0)
    bake_ao([wheel_lod])
    wheel_lod.location = (0, 0, 0)

# ------------------------------------------------------------------ export
for ob in (body, wheel, wheel_lod, whip):
    ob.data.color_attributes.active_color = ob.data.color_attributes['AO'] if 'AO' in ob.data.color_attributes else None
bpy.ops.object.select_all(action='DESELECT')
for ob in [body, wheel, wheel_lod, whip] + markers:
    ob.select_set(True)
bpy.ops.export_scene.gltf(
    filepath=OUT, export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
    export_vertex_color='ACTIVE', export_normals=True, export_texcoords=True, export_materials='EXPORT',
    export_image_format='NONE', export_animations=False, export_cameras=False, export_lights=False,
    export_extras=False, export_tangents=False, export_meshopt_compression_enable=True,
)
tri = lambda ob: sum(len(p.vertices) - 2 for p in ob.data.polygons)
print('EXPORTED', OUT, 'body tris', tri(body), 'wheel tris', tri(wheel), 'lod', tri(wheel_lod), 'whip tris', tri(whip))

# ------------------------------------------------------------------ preview render
if PREVIEW:
    import os
    wheel_lod.hide_render = True
    # assemble a display copy with 4 wheels
    for x in (WHEEL_X, -WHEEL_X):
        for y in (WHEEL_Y, -WHEEL_Y):
            t = wheel.copy()
            COLL.objects.link(t)
            t.location = (x, y, WHEEL_R)
            if y < 0: t.scale = (1, -1, 1)
    M['paint'].node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.75, 0.04, 0.03, 1)
    M['accent'].node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.9, 0.9, 0.9, 1)
    bpy.ops.mesh.primitive_plane_add(size=40, location=(0, 0, 0))
    gp = bpy.context.active_object
    gm = material('Ground', (0.32, 0.18, 0.1), 0, 0.9)
    gp.data.materials.append(gm)
    sun = bpy.data.lights.new('Sun', 'SUN'); sun.energy = 4.0; sun.angle = math.radians(3)
    so = bpy.data.objects.new('Sun', sun); COLL.objects.link(so)
    so.rotation_euler = (math.radians(50), 0, math.radians(140))
    w = scene.world
    w.use_nodes = True
    bg = w.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = (0.55, 0.65, 0.8, 1); bg.inputs['Strength'].default_value = 0.8
    cam = bpy.data.cameras.new('Cam'); cam.lens = 55
    co = bpy.data.objects.new('Cam', cam); COLL.objects.link(co)
    views = [((7.5, 5.5, 3.2), 'a'), ((-6.5, 6.0, 5.5), 'b'), ((0.5, 0.01, 11), 'c')]
    for pos, tag in views:
        co.location = pos
        d = Vector((0, 0, 0.9)) - Vector(pos)
        co.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
        scene.camera = co
        scene.render.resolution_x, scene.render.resolution_y = 960, 600
        scene.cycles.samples = 64
        scene.cycles.use_denoising = True
        scene.render.filepath = PREVIEW.replace('.png', f'_{tag}.png')
        bpy.ops.render.render(write_still=True)
        print('PREVIEW', scene.render.filepath)
