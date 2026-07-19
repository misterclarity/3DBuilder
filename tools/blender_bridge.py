# blender_bridge.py — local Blender service for DIY Workshop.
#
# Run (keep the terminal open):
#   blender --background --python tools/blender_bridge.py
#   blender --background --python tools/blender_bridge.py -- --port 8800
#
# Exposes a small HTTP API (CORS enabled) the web app talks to:
#   GET  /health           -> {ok, blender, engine}
#   POST /render {design, width?, height?, views?, samples?, engine?}
#                          -> {images: ["data:image/png;base64,...", ...], seconds}
#        views: [[azimuthDeg, elevationDeg], ...]  (default one pleasant iso view)
#   POST /stl    {design}  -> binary STL (mm units, wood parts only, cutouts applied)
#   POST /glb    {design}  -> binary GLB (parts + plants, cutouts applied)
#
# The design JSON is the app's native schema (mm, y-up). Cutouts become real
# boolean differences. Requires Blender 3.6+ (tested against the 3.6/4.x APIs;
# version differences are handled with fallbacks).

import base64
import json
import math
import os
import sys
import tempfile
import time
import traceback
from http.server import BaseHTTPRequestHandler, HTTPServer

import bpy
from mathutils import Euler, Matrix, Vector

S = 0.001  # mm -> m

# app axes (y-up, +z to viewer)  ->  Blender axes (z-up, -y to viewer)
def conv(v):
    return Vector((v.get('x', 0) * S, -v.get('z', 0) * S, v.get('y', 0) * S))

# Change of basis for rotations: columns are the app axes expressed in Blender axes.
C_APP2BL = Matrix(((1, 0, 0), (0, 0, -1), (0, 1, 0)))

SPECIES_COLORS = {
    'pine': '#d9b380', 'spruce': '#e3c496', 'oak': '#c49a6c', 'beech': '#d7a97f',
    'birch': '#e8d3ae', 'walnut': '#6b4a2f', 'mahogany': '#7e3b26', 'plywood': '#dec294',
    'mdf': '#c8b08a', 'metal': '#9aa2ab', 'larch': '#c99a66', 'soil': '#4a3b2c'
}
HABIT_GREEN = {
    'leafy': '#66bb6a', 'bushy': '#4caf50', 'vining': '#7cb342', 'climbing': '#7cb342',
    'root': '#8bc34a', 'herb': '#81c784', 'flower': '#66bb6a', 'shrub': '#388e3c',
    'tree': '#2e7d32', 'grass': '#9ccc65'
}


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_rgba(hx, fallback='#c49a6c'):
    hx = (hx or fallback).lstrip('#')
    if len(hx) == 3:
        hx = ''.join(ch * 2 for ch in hx)
    try:
        r, g, b = (int(hx[i:i + 2], 16) / 255.0 for i in (0, 2, 4))
    except Exception:
        return hex_rgba(fallback)
    return (srgb_to_linear(r), srgb_to_linear(g), srgb_to_linear(b), 1.0)


_mat_cache = {}


def material(color_hex, roughness=0.8, metallic=0.0):
    key = (color_hex, round(roughness, 2), metallic)
    if key in _mat_cache and _mat_cache[key].name in bpy.data.materials:
        return _mat_cache[key]
    m = bpy.data.materials.new('m_' + str(len(_mat_cache)))
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get('Principled BSDF')
    if bsdf:
        bsdf.inputs['Base Color'].default_value = hex_rgba(color_hex)
        bsdf.inputs['Roughness'].default_value = roughness
        bsdf.inputs['Metallic'].default_value = metallic
    _mat_cache[key] = m
    return m


def part_material(part):
    mat = part.get('material') or {}
    species = str(mat.get('species') or 'pine').lower()
    base = SPECIES_COLORS.get(species)
    if base is None:
        base = SPECIES_COLORS['plywood'] if 'ply' in species else (
            SPECIES_COLORS['metal'] if any(k in species for k in ('metal', 'steel', 'alu')) else SPECIES_COLORS['pine'])
    color = mat.get('color') or base
    shine = mat.get('shine') or 0.15
    return material(color, roughness=max(0.05, 1 - shine * 0.9),
                    metallic=0.7 if species == 'metal' else 0.0)


def reset_scene():
    bpy.ops.wm.read_homefile(use_empty=True)
    _mat_cache.clear()
    bpy.context.scene.unit_settings.system = 'METRIC'


def add_cube(name, dims_m):
    bpy.ops.mesh.primitive_cube_add(size=1)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = dims_m
    bpy.ops.object.transform_apply(scale=True)  # keep matrix_world scale-free for booleans
    return obj


def add_cylinder(name, radius_m, depth_m, verts=48):
    bpy.ops.mesh.primitive_cylinder_add(radius=radius_m, depth=depth_m, vertices=verts)
    obj = bpy.context.active_object
    obj.name = name
    return obj


def app_rotation_matrix(rot):
    rot = rot or {}
    e = Euler((math.radians(rot.get('x', 0)), math.radians(rot.get('y', 0)),
               math.radians(rot.get('z', 0))), 'YXZ')  # A-Frame/THREE order
    return C_APP2BL @ e.to_matrix() @ C_APP2BL.transposed()


def apply_boolean(obj, cutter):
    cutter.display_type = 'WIRE'
    mod = obj.modifiers.new('cut', 'BOOLEAN')
    mod.operation = 'DIFFERENCE'
    mod.object = cutter
    try:
        mod.solver = 'EXACT'
    except Exception:
        pass
    try:
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=mod.name)
        bpy.data.objects.remove(cutter, do_unlink=True)
    except Exception:
        # applying failed (context quirks) — keep the live modifier, hide the cutter
        cutter.hide_render = True
        cutter['kind'] = 'cutter'


def build_part(part):
    dims = part.get('dimensions') or {}
    if part.get('shape') == 'cylinder':
        obj = add_cylinder('P_' + part.get('id', '?'),
                           max(1, dims.get('radius', 20)) * S,
                           max(1, dims.get('height', 100)) * S)
    else:
        obj = add_cube('P_' + part.get('id', '?'),
                       (max(1, dims.get('x', 100)) * S,
                        max(1, dims.get('z', 100)) * S,   # app z -> Blender y
                        max(1, dims.get('y', 100)) * S))  # app y -> Blender z
    R = app_rotation_matrix(part.get('rotation'))
    obj.matrix_world = Matrix.Translation(conv(part.get('position') or {})) @ R.to_4x4()
    obj.data.materials.append(part_material(part))
    obj['kind'] = 'part'

    # circular through-hole cutouts (positions are relative to the part center, app axes)
    for co in (part.get('cutouts') or []):
        dia = co.get('diameter') or 0
        if not dia or part.get('shape') == 'cylinder':
            continue
        axis = co.get('axis') if co.get('axis') in ('x', 'y', 'z') else 'y'
        depth = (dims.get(axis, 20) + 20) * S
        cutter = add_cylinder('cut', dia / 2 * S, depth, verts=48)
        off = co.get('offset') or {}
        # local frame: app x -> +xB, app y -> +zB, app z -> -yB; cylinder default = zB (app y)
        local_rot = Matrix.Identity(3)
        if axis == 'x':
            local_rot = Matrix.Rotation(math.radians(90), 3, 'Y')
        elif axis == 'z':
            local_rot = Matrix.Rotation(math.radians(90), 3, 'X')
        local = Matrix.Translation(Vector((off.get('x', 0) * S, -off.get('z', 0) * S, off.get('y', 0) * S))) @ local_rot.to_4x4()
        cutter.matrix_world = obj.matrix_world @ local
        apply_boolean(obj, cutter)
    return obj


def add_shape(name, kind, pos, scale, color, rough=0.85):
    if kind == 'sphere':
        bpy.ops.mesh.primitive_uv_sphere_add(radius=1, segments=24, ring_count=16)
    elif kind == 'cone':
        bpy.ops.mesh.primitive_cone_add(radius1=1, radius2=0.01, depth=2, vertices=24)
    else:
        bpy.ops.mesh.primitive_cylinder_add(radius=1, depth=2, vertices=16)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = scale
    obj.location = pos
    bpy.ops.object.shade_smooth()
    obj.data.materials.append(material(color, roughness=rough))
    obj['kind'] = 'plant'
    return obj


def build_plant(p):
    h = max(0.04, (p.get('matureHeight') or 300) * S)
    r = max(0.02, (p.get('matureDiameter') or 250) * S / 2)
    habit = p.get('habit') or 'bushy'
    green = HABIT_GREEN.get(habit, '#4caf50')
    accent = p.get('color')
    base = conv(p.get('position') or {})
    n = 'PL_' + p.get('id', '?')

    def at(dx, dy_up, dz):  # offsets in app-like terms (x, height, z)
        return base + Vector((dx, -dz, dy_up))

    if habit == 'leafy':
        add_shape(n, 'sphere', at(0, h / 2, 0), (r, r, h / 2), accent or green)
    elif habit == 'root':
        add_shape(n, 'cone', at(0, h / 2, 0), (r * 0.55, r * 0.55, h / 2), green)
    elif habit == 'grass':
        add_shape(n, 'cone', at(0, h / 2, 0), (r * 0.5, r * 0.5, h / 2), green)
    elif habit == 'herb':
        add_shape(n, 'sphere', at(-r * 0.3, h * 0.55, r * 0.15), (r * 0.55,) * 3, green)
        add_shape(n, 'sphere', at(r * 0.3, h * 0.6, -r * 0.1), (r * 0.5,) * 3, green)
        add_shape(n, 'sphere', at(0, h * 0.78, 0), (r * 0.5,) * 3, accent or green)
    elif habit == 'flower':
        add_shape(n, 'cyl', at(0, h * 0.375, 0), (max(0.004, r * 0.05),) * 2 + (h * 0.375,), '#558b2f')
        add_shape(n, 'sphere', at(0, h * 0.88, 0), (r * 0.38,) * 3, accent or '#f06292')
    elif habit == 'climbing':
        add_shape(n, 'cyl', at(0, h / 2, 0), (0.008, 0.008, h / 2), '#8d6e63')
        for k, (dx, dy, dz) in enumerate(((0.15, 0.3, 0), (-0.15, 0.58, 0.1), (0, 0.85, -0.05))):
            add_shape(n, 'sphere', at(r * dx, h * dy, r * dz), (r * 0.5,) * 3, accent if k == 2 and accent else green)
    elif habit in ('tree', 'shrub'):
        trunk_h = h * (0.45 if habit == 'tree' else 0.25)
        add_shape(n, 'cyl', at(0, trunk_h / 2, 0), (max(0.012, r * 0.09),) * 2 + (trunk_h / 2,), '#795548')
        add_shape(n, 'sphere', at(0, h * (0.7 if habit == 'tree' else 0.55), 0), (r, r, h * 0.3), green)
        if accent and habit == 'tree':
            for dx, dy, dz in ((0.6, 0.72, 0.5), (-0.65, 0.62, 0.25), (0.1, 0.8, -0.6)):
                add_shape(n, 'sphere', at(r * dx, h * dy, r * dz), (min(0.08, r * 0.12),) * 3, accent)
    elif habit == 'vining':
        add_shape(n, 'sphere', at(-r * 0.5, h * 0.4, 0), (r * 0.6, r * 0.6, h / 2), green)
        add_shape(n, 'sphere', at(r * 0.5, h * 0.45, r * 0.15), (r * 0.6, r * 0.6, h / 2), accent or green)
    else:  # bushy
        add_shape(n, 'cyl', at(0, h * 0.25, 0), (max(0.006, r * 0.06),) * 2 + (h * 0.25,), '#7a9e5f')
        add_shape(n, 'sphere', at(0, h * 0.6, 0), (r * 0.9, r * 0.9, h * 0.375), green)
        if accent:
            for dx, dy, dz in ((0.5, 0.5, 0.55), (-0.55, 0.62, 0.2), (0.15, 0.72, -0.55)):
                add_shape(n, 'sphere', at(r * dx, h * dy, r * dz), (min(0.05, r * 0.22),) * 3, accent)


def build_env():
    bpy.ops.mesh.primitive_plane_add(size=30)
    ground = bpy.context.active_object
    ground.name = 'ground'
    ground.data.materials.append(material('#39424a', roughness=0.95))
    ground['kind'] = 'env'
    bpy.ops.object.light_add(type='SUN')
    sun = bpy.context.active_object
    sun.data.energy = 3.5
    sun.data.angle = math.radians(4)
    sun.rotation_euler = (math.radians(50), 0, math.radians(135))
    sun['kind'] = 'env'
    world = bpy.data.worlds.new('w')
    bpy.context.scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get('Background')
    if bg:
        bg.inputs[0].default_value = (0.45, 0.55, 0.68, 1.0)
        bg.inputs[1].default_value = 1.0


def build_scene(design, plants=True, env=True):
    reset_scene()
    for part in (design.get('parts') or []):
        build_part(part)
    if plants:
        for p in (design.get('plants') or []):
            build_plant(p)
    if env:
        build_env()


def scene_bounds():
    lo = Vector((1e9,) * 3)
    hi = Vector((-1e9,) * 3)
    found = False
    for obj in bpy.data.objects:
        if obj.get('kind') in ('part', 'plant'):
            for corner in obj.bound_box:
                w = obj.matrix_world @ Vector(corner)
                lo = Vector(map(min, lo, w))
                hi = Vector(map(max, hi, w))
                found = True
    if not found:
        lo, hi = Vector((-1, -1, 0)), Vector((1, 1, 1))
    return lo, hi


def set_camera(az_deg, elev_deg):
    lo, hi = scene_bounds()
    center = (lo + hi) / 2
    radius = max(0.3, (hi - lo).length / 2)
    az, el = math.radians(az_deg), math.radians(elev_deg)
    # direction in app terms (x, up, front) -> Blender
    d_app = (math.sin(az) * math.cos(el), math.sin(el), math.cos(az) * math.cos(el))
    d_bl = Vector((d_app[0], -d_app[2], d_app[1]))
    fov = 2 * math.atan(18 / 50)  # 50 mm lens, 36 mm sensor
    loc = center + d_bl * (radius / math.tan(fov / 2) * 1.15)
    cam_data = bpy.data.cameras.new('cam')
    cam_data.lens = 50
    cam = bpy.data.objects.new('cam', cam_data)
    bpy.context.collection.objects.link(cam)
    cam.location = loc
    cam.rotation_euler = (center - loc).to_track_quat('-Z', 'Y').to_euler()
    bpy.context.scene.camera = cam
    return cam


def setup_engine(engine, samples):
    scene = bpy.context.scene
    if engine == 'eevee':
        for name in ('BLENDER_EEVEE_NEXT', 'BLENDER_EEVEE'):
            try:
                scene.render.engine = name
                return
            except Exception:
                continue
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = samples
    try:
        scene.cycles.use_denoising = True
    except Exception:
        pass


def do_render(design, width, height, views, samples, engine):
    build_scene(design)
    setup_engine(engine, samples)
    scene = bpy.context.scene
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.image_settings.file_format = 'PNG'
    images = []
    for az, el in views:
        set_camera(az, el)
        path = os.path.join(tempfile.gettempdir(), 'diyw_render.png')
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        with open(path, 'rb') as f:
            images.append('data:image/png;base64,' + base64.b64encode(f.read()).decode('ascii'))
    return images


def select_kinds(kinds):
    bpy.ops.object.select_all(action='DESELECT')
    for obj in bpy.data.objects:
        if obj.get('kind') in kinds:
            obj.select_set(True)
            bpy.context.view_layer.objects.active = obj


def do_stl(design):
    build_scene(design, plants=False, env=False)
    select_kinds(('part',))
    path = os.path.join(tempfile.gettempdir(), 'diyw.stl')
    try:  # Blender 4.x
        bpy.ops.wm.stl_export(filepath=path, export_selected_objects=True,
                              global_scale=1000.0, apply_modifiers=True)
    except AttributeError:  # Blender <= 3.6
        bpy.ops.export_mesh.stl(filepath=path, use_selection=True,
                                global_scale=1000.0, use_mesh_modifiers=True)
    with open(path, 'rb') as f:
        return f.read()


def do_glb(design):
    build_scene(design, plants=True, env=False)
    select_kinds(('part', 'plant'))
    path = os.path.join(tempfile.gettempdir(), 'diyw.glb')
    try:
        bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True)
    except TypeError:
        bpy.ops.export_scene.gltf(filepath=path, export_format='GLB')
    with open(path, 'rb') as f:
        return f.read()


# ---------------- HTTP ----------------
class Handler(BaseHTTPRequestHandler):
    def _headers(self, code, ctype, extra=None):
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()

    def _json(self, code, obj):
        body = json.dumps(obj).encode('utf-8')
        self._headers(code, 'application/json', {'Content-Length': str(len(body))})
        self.wfile.write(body)

    def do_OPTIONS(self):
        self._headers(204, 'text/plain')

    def do_GET(self):
        if self.path.rstrip('/') in ('', '/health'):
            self._json(200, {'ok': True, 'blender': bpy.app.version_string,
                             'service': 'diyw-blender-bridge'})
        else:
            self._json(404, {'error': 'not found'})

    def do_POST(self):
        try:
            length = int(self.headers.get('Content-Length') or 0)
            payload = json.loads(self.rfile.read(length).decode('utf-8')) if length else {}
            design = payload.get('design') or {}
            t0 = time.time()
            if self.path == '/render':
                views = payload.get('views') or [[35, 25]]
                images = do_render(design,
                                   int(payload.get('width') or 1024),
                                   int(payload.get('height') or 768),
                                   views,
                                   int(payload.get('samples') or 32),
                                   str(payload.get('engine') or 'cycles').lower())
                self._json(200, {'images': images, 'seconds': round(time.time() - t0, 1)})
            elif self.path == '/stl':
                data = do_stl(design)
                self._headers(200, 'application/octet-stream',
                              {'Content-Length': str(len(data)),
                               'Content-Disposition': 'attachment; filename="design.stl"'})
                self.wfile.write(data)
            elif self.path == '/glb':
                data = do_glb(design)
                self._headers(200, 'model/gltf-binary',
                              {'Content-Length': str(len(data)),
                               'Content-Disposition': 'attachment; filename="design.glb"'})
                self.wfile.write(data)
            else:
                self._json(404, {'error': 'not found'})
        except Exception as e:
            traceback.print_exc()
            self._json(500, {'error': str(e)})

    def log_message(self, fmt, *args):
        print('[bridge]', fmt % args)


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    port = 8800
    host = '127.0.0.1'
    for i, a in enumerate(argv):
        if a == '--port' and i + 1 < len(argv):
            port = int(argv[i + 1])
        if a == '--host' and i + 1 < len(argv):
            host = argv[i + 1]
    print('DIY Workshop Blender bridge — Blender %s' % bpy.app.version_string)
    print('Listening on http://%s:%d  (Ctrl+C to stop)' % (host, port))
    HTTPServer((host, port), Handler).serve_forever()


if __name__ == '__main__':
    main()
