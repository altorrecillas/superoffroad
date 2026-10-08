# Title logo: extruded chrome/gold "SUPER OFF ROAD" with an 80s horizon-reflection
# look, rendered with Cycles to a transparent PNG.
# Run: blender -b --factory-startup --python tools/blender/logo.py -- <font.ttf> <out.png> [samples]

import bpy, math, sys

argv = sys.argv[sys.argv.index('--') + 1:]
FONT, OUT = argv[0], argv[1]
SAMPLES = int(argv[2]) if len(argv) > 2 else 96

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
coll = bpy.context.collection
font = bpy.data.fonts.load(FONT)


def node_mat(name, build):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    shader = build(nt)
    nt.links.new(shader.outputs[0], out.inputs['Surface'])
    return m


def chrome_gold(nt):
    """gold chrome on faces looking at the camera, dark red on the extruded sides"""
    geo = nt.nodes.new('ShaderNodeNewGeometry')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(geo.outputs['Normal'], sep.inputs[0])
    face = nt.nodes.new('ShaderNodeMapRange')
    face.inputs['From Min'].default_value = 0.75
    face.inputs['From Max'].default_value = 0.95
    nt.links.new(sep.outputs['Z'], face.inputs['Value'])
    # vertical gradient across the letters
    tc = nt.nodes.new('ShaderNodeTexCoord')
    sepo = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(tc.outputs['Object'], sepo.inputs[0])
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    mr = nt.nodes.new('ShaderNodeMapRange')
    mr.inputs['From Min'].default_value = -0.9
    mr.inputs['From Max'].default_value = 0.9
    nt.links.new(sepo.outputs['Y'], mr.inputs['Value'])
    nt.links.new(mr.outputs[0], ramp.inputs['Fac'])
    cr = ramp.color_ramp
    cr.elements[0].position = 0.0; cr.elements[0].color = (1.0, 0.62, 0.22, 1)
    cr.elements[1].position = 1.0; cr.elements[1].color = (1.0, 0.9, 0.62, 1)
    gold = nt.nodes.new('ShaderNodeBsdfPrincipled')
    gold.inputs['Metallic'].default_value = 1.0
    gold.inputs['Roughness'].default_value = 0.08
    nt.links.new(ramp.outputs['Color'], gold.inputs['Base Color'])
    side = nt.nodes.new('ShaderNodeBsdfPrincipled')
    side.inputs['Base Color'].default_value = (0.6, 0.03, 0.02, 1)
    side.inputs['Metallic'].default_value = 0.15
    side.inputs['Roughness'].default_value = 0.32
    mix = nt.nodes.new('ShaderNodeMixShader')
    nt.links.new(face.outputs[0], mix.inputs['Fac'])
    nt.links.new(side.outputs[0], mix.inputs[1])
    nt.links.new(gold.outputs[0], mix.inputs[2])
    return mix


def flat(color, metallic=0.0, rough=0.4, emission=0.0):
    def b(nt):
        p = nt.nodes.new('ShaderNodeBsdfPrincipled')
        p.inputs['Base Color'].default_value = (*color, 1)
        p.inputs['Metallic'].default_value = metallic
        p.inputs['Roughness'].default_value = rough
        if emission:
            p.inputs['Emission Color'].default_value = (*color, 1)
            p.inputs['Emission Strength'].default_value = emission
        return p
    return b


GOLD = node_mat('Gold', chrome_gold)
OUTLINE = node_mat('Outline', flat((0.09, 0.01, 0.01), 0.3, 0.3))
WHITE = node_mat('White', flat((0.95, 0.95, 0.95), 0.0, 0.3))
RED = node_mat('Red', flat((0.7, 0.04, 0.03), 0.2, 0.35))


def text(body, size, extrude, bevel, loc, mat, offset=0.0, shear=0.2, spacing=1.0):
    cu = bpy.data.curves.new('txt', 'FONT')
    cu.body = body
    cu.font = font
    cu.size = size
    cu.extrude = extrude
    cu.bevel_depth = bevel
    cu.bevel_resolution = 3
    cu.offset = offset
    cu.shear = shear
    cu.space_character = spacing
    cu.align_x = 'CENTER'
    cu.align_y = 'CENTER'
    ob = bpy.data.objects.new('txt', cu)
    coll.objects.link(ob)
    ob.location = loc
    cu.materials.append(mat)
    return ob


# main title with a dark outline behind it
text('SUPER OFF ROAD', 2.6, 0.32, 0.06, (0, 0, 0), GOLD, spacing=1.02)
text('SUPER OFF ROAD', 2.6, 0.45, 0.0, (0, 0, -0.55), OUTLINE, offset=0.17, spacing=1.02)
# top line
text('IVAN "IRONMAN" STEWART\'S', 0.95, 0.12, 0.02, (0, 1.95, 0.1), WHITE, spacing=1.06)
text('IVAN "IRONMAN" STEWART\'S', 0.95, 0.08, 0.0, (0, 1.95, -0.05), RED, offset=0.06, spacing=1.06)

# world: sharp bright horizon for the chrome reflections
w = bpy.data.worlds.new('W')
scene.world = w
w.use_nodes = True
nt = w.node_tree
bg = nt.nodes['Background']
tc = nt.nodes.new('ShaderNodeTexCoord')
sep = nt.nodes.new('ShaderNodeSeparateXYZ')
nt.links.new(tc.outputs['Generated'], sep.inputs[0])
ramp = nt.nodes.new('ShaderNodeValToRGB')
mr = nt.nodes.new('ShaderNodeMapRange')
# reflected rays off the letters span Y ~0.21..0.30: put the horizon through the middle
mr.inputs['From Min'].default_value = 0.17
mr.inputs['From Max'].default_value = 0.34
# reflections of a camera looking down the -Z axis come mostly from +Z: put the horizon there
nt.links.new(sep.outputs['Y'], mr.inputs['Value'])
nt.links.new(mr.outputs[0], ramp.inputs['Fac'])
cr = ramp.color_ramp
cr.elements[0].position = 0.0; cr.elements[0].color = (0.05, 0.025, 0.012, 1)
cr.elements[1].position = 0.44; cr.elements[1].color = (0.55, 0.22, 0.05, 1)
e = cr.elements.new(0.495); e.color = (0.25, 0.08, 0.02, 1)
e = cr.elements.new(0.5); e.color = (7.0, 6.0, 4.5, 1)
e = cr.elements.new(0.53); e.color = (1.6, 1.4, 1.2, 1)
e = cr.elements.new(0.75); e.color = (0.45, 0.65, 1.2, 1)
e = cr.elements.new(1.0); e.color = (0.06, 0.12, 0.5, 1)
nt.links.new(ramp.outputs['Color'], bg.inputs['Color'])
bg.inputs['Strength'].default_value = 1.2

# key light for sparkle
al = bpy.data.lights.new('Key', 'AREA')
al.energy = 600
al.size = 6
alo = bpy.data.objects.new('Key', al)
coll.objects.link(alo)
alo.location = (-6, -4, 10)
alo.rotation_euler = (math.radians(35), math.radians(-25), 0)

cam = bpy.data.cameras.new('Cam')
cam.lens = 40
co = bpy.data.objects.new('Cam', cam)
coll.objects.link(co)
co.location = (0, -7.2, 27)
co.rotation_euler = (math.radians(15), 0, 0)
scene.camera = co

scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = SAMPLES
scene.cycles.use_denoising = True
scene.render.film_transparent = True
scene.render.resolution_x = 2000
scene.render.resolution_y = 640
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGBA'
scene.view_settings.view_transform = 'AgX'
scene.view_settings.look = 'AgX - Punchy'
scene.render.filepath = OUT
bpy.ops.render.render(write_still=True)
print('LOGO', OUT)
