# App icon: the red truck from assets/models/truck.glb, rendered with Cycles.
# Run: blender -b --factory-startup --python tools/blender/icon.py -- assets/models/truck.glb out.png [samples]

import bpy, math, sys
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
GLB, OUT = argv[0], argv[1]
SAMPLES = int(argv[2]) if len(argv) > 2 else 96

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
coll = bpy.context.collection
bpy.ops.import_scene.gltf(filepath=GLB)

wheel = bpy.data.objects.get('Wheel')
for x in (1.42, -1.42):
    for y in (0.98, -0.98):
        w = wheel.copy()
        coll.objects.link(w)
        w.location = (x, y, 0.48)
        w.rotation_euler = (0, 0, 0)
        w.rotation_mode = 'XYZ'
        if y < 0:
            w.scale = (1, -1, 1)
        w.rotation_euler[1] = 0.3 * (1 if x > 0 else 2)
wheel.hide_render = True

for m in bpy.data.materials:
    if not m.use_nodes:
        continue
    b = m.node_tree.nodes.get('Principled BSDF')
    if not b:
        continue
    if m.name.startswith('Paint') or m.name.startswith('Decal'):
        # the importer multiplies the base colour by the AO attribute: drop the link, set the colour
        for l in list(m.node_tree.links):
            if l.to_socket == b.inputs['Base Color']:
                m.node_tree.links.remove(l)
        b.inputs['Base Color'].default_value = (0.62, 0.025, 0.02, 1) if m.name.startswith('Paint') else (0.93, 0.93, 0.9, 1)

# backdrop: warm dirt-coloured sweep
bpy.ops.mesh.primitive_plane_add(size=60, location=(0, 0, 0))
floor = bpy.context.active_object
fm = bpy.data.materials.new('Floor')
fm.use_nodes = True
fb = fm.node_tree.nodes['Principled BSDF']
fb.inputs['Base Color'].default_value = (0.16, 0.06, 0.025, 1)
fb.inputs['Roughness'].default_value = 0.85
floor.data.materials.append(fm)

w = bpy.data.worlds.new('W')
scene.world = w
w.use_nodes = True
w.node_tree.nodes['Background'].inputs['Color'].default_value = (1.0, 0.6, 0.3, 1)
w.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.75

sun = bpy.data.lights.new('Sun', 'SUN')
sun.energy = 4.5
sun.angle = math.radians(6)
so = bpy.data.objects.new('Sun', sun)
coll.objects.link(so)
so.rotation_euler = (math.radians(48), 0, math.radians(-135))

cam = bpy.data.cameras.new('Cam')
cam.lens = 95
co = bpy.data.objects.new('Cam', cam)
coll.objects.link(co)
co.location = (8.6, -6.4, 4.6)
d = Vector((0.1, 0, 0.85)) - co.location
co.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
scene.camera = co

scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = SAMPLES
scene.cycles.use_denoising = True
scene.render.resolution_x = 512
scene.render.resolution_y = 512
scene.view_settings.view_transform = 'AgX'
scene.view_settings.look = 'AgX - Punchy'
scene.render.filepath = OUT
bpy.ops.render.render(write_still=True)
print('ICON', OUT)
