"""Build the four Lightbox models procedurally and export them as binary glTF.

Run headless from the repository root:

    blender --background --factory-startup --python blender/make_models.py

Optional arguments go after a bare "--":

    --preview DIR   also render a Workbench contact sheet per model into DIR
    --only NAME     build a single model (wineglass, tumbler, knot, cat)

Output: public/models/{wineglass,tumbler,knot,cat}.glb, located relative to
this file. Each model is one closed, manifold, outward-facing triangle mesh
with smooth vertex normals, +Y up, standing on y = 0, in metres. The script
checks every mesh with bmesh, re-reads every exported file, and exits with a
non-zero status if any model fails.
"""

import json
import math
import os
import struct
import sys
import traceback

import bmesh
import bpy
import numpy as np
from mathutils import Euler, Matrix, Vector
from mathutils.bvhtree import BVHTree

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.normpath(os.path.join(HERE, "..", "public", "models"))
MAX_BYTES = 600 * 1024


# --------------------------------------------------------------------------
# Profile helpers (2D curves in the (radius, height) half-plane)
# --------------------------------------------------------------------------

def fillet_polyline(corners, radii, step_deg=2.0):
    """Polyline through `corners` with each interior corner rounded to an arc."""
    pts = [np.array(corners[0], float)]
    for i in range(1, len(corners) - 1):
        p0, p1, p2 = (np.array(c, float) for c in corners[i - 1:i + 2])
        r = radii[i]
        d1 = (p1 - p0) / np.linalg.norm(p1 - p0)
        d2 = (p2 - p1) / np.linalg.norm(p2 - p1)
        cross = d1[0] * d2[1] - d1[1] * d2[0]
        dot = float(np.clip(d1 @ d2, -1.0, 1.0))
        phi = math.atan2(cross, dot)  # signed turn at this corner
        if r <= 0.0 or abs(phi) < 1e-6:
            pts.append(p1)
            continue
        tangent_len = r * math.tan(abs(phi) / 2.0)
        start = p1 - d1 * tangent_len
        side = 1.0 if phi > 0.0 else -1.0
        centre = start + side * np.array([-d1[1], d1[0]]) * r
        a0 = math.atan2(start[1] - centre[1], start[0] - centre[0])
        n = max(2, int(math.ceil(abs(phi) / math.radians(step_deg))))
        for k in range(n + 1):
            ang = a0 + phi * k / n
            pts.append(centre + r * np.array([math.cos(ang), math.sin(ang)]))
    pts.append(np.array(corners[-1], float))
    return np.array(pts)


def resample_profile(pts, max_len, max_angle_deg, count=None):
    """Resample a dense polyline so no segment is longer than `max_len` or
    turns more than `max_angle_deg`: flat runs get few points, tight curves
    (rims, fillets) get many. With `count` the two limits only set the balance
    between length and curvature and the result has exactly `count` segments."""
    pts = np.asarray(pts, float)
    d = np.diff(pts, axis=0)
    ds = np.hypot(d[:, 0], d[:, 1])
    pts = pts[np.concatenate(([True], ds > 1e-9))]
    d = np.diff(pts, axis=0)
    ds = np.hypot(d[:, 0], d[:, 1])
    ang = np.unwrap(np.arctan2(d[:, 1], d[:, 0]))
    turn = np.abs(np.diff(ang))
    if turn.max() > math.radians(30.0):
        # A kink or a fold-back in the input, which would crease the surface.
        k = int(turn.argmax()) + 1
        raise ValueError("profile is not smooth at (%.6f, %.6f): turns %.1f degrees"
                         % (pts[k, 0], pts[k, 1], math.degrees(turn.max())))
    per_seg = np.zeros(len(ds))
    per_seg[:-1] += 0.5 * turn
    per_seg[1:] += 0.5 * turn
    measure = ds / max_len + per_seg / math.radians(max_angle_deg)
    cum = np.concatenate(([0.0], np.cumsum(measure)))
    n = count if count else int(math.ceil(cum[-1]))
    target = np.linspace(0.0, cum[-1], n + 1)
    out = np.column_stack((np.interp(target, cum, pts[:, 0]),
                           np.interp(target, cum, pts[:, 1])))
    out[0, 0] = 0.0
    out[-1, 0] = 0.0
    return out


def lathe(profile, segments, bm=None, matrix=None):
    """Revolve a profile about the Z axis into a closed surface. The first and
    last profile points must lie on the axis; they become single pole vertices,
    so the skin closes without caps or seams."""
    if bm is None:
        bm = bmesh.new()
    if matrix is None:
        matrix = Matrix.Identity(4)
    if abs(profile[0][0]) > 1e-12 or abs(profile[-1][0]) > 1e-12:
        raise ValueError("lathe profile must start and end on the axis")
    for r, _z in profile[1:-1]:
        if r <= 1e-7:
            raise ValueError("lathe profile touches the axis between its ends")
    first = bm.verts.new(matrix @ Vector((0.0, 0.0, profile[0][1])))
    last = bm.verts.new(matrix @ Vector((0.0, 0.0, profile[-1][1])))
    rings = []
    for r, z in profile[1:-1]:
        rings.append([
            bm.verts.new(matrix @ Vector((r * math.cos(2.0 * math.pi * j / segments),
                                          r * math.sin(2.0 * math.pi * j / segments),
                                          z)))
            for j in range(segments)
        ])
    for j in range(segments):
        k = (j + 1) % segments
        bm.faces.new((first, rings[0][k], rings[0][j]))
        for i in range(len(rings) - 1):
            bm.faces.new((rings[i][j], rings[i][k], rings[i + 1][k], rings[i + 1][j]))
        bm.faces.new((last, rings[-1][j], rings[-1][k]))
    return bm


# --------------------------------------------------------------------------
# Wine glass
# --------------------------------------------------------------------------

def wineglass_profile():
    height = 0.210
    wall = 0.0036          # bowl wall, about 1.7 % of the height
    zb = 0.099             # inside bottom of the bowl
    # Inside of the bowl: a cubic Bezier from the axis up to the rim.
    ctrl = np.array([(0.0, zb), (0.041, zb), (0.050, 0.160), (0.0305, height - 0.0025)])
    t = np.linspace(0.0, 1.0, 1501)[:, None]
    inner = ((1 - t) ** 3 * ctrl[0] + 3 * (1 - t) ** 2 * t * ctrl[1]
             + 3 * (1 - t) * t ** 2 * ctrl[2] + t ** 3 * ctrl[3])
    tan = (3 * (1 - t) ** 2 * (ctrl[1] - ctrl[0]) + 6 * (1 - t) * t * (ctrl[2] - ctrl[1])
           + 3 * t ** 2 * (ctrl[3] - ctrl[2]))
    tan /= np.linalg.norm(tan, axis=1)[:, None]
    normal = np.column_stack((tan[:, 1], -tan[:, 0]))
    outer = inner + wall * normal      # outside of the bowl, a true offset

    # Foot: flat underside, rounded edge, then a trumpet curve into the stem.
    foot_r = 0.036
    edge = 0.0017                      # radius of the rounded foot edge
    stem_r = 0.0041
    foot_fall = 0.0042
    flare = 0.0065                     # the stem widens into the bowl
    flare_len = 0.016
    # Fillet between stem and bowl. It must stay below the stem radius at the
    # bowl (stem_r + flare): the blend then starts on the bowl curve away from
    # the axis, where its slope is finite, and the profile stays smooth.
    blend = 0.009
    th_end = math.atan2(foot_r - edge - stem_r, foot_fall)
    arc_t = np.linspace(-math.pi / 2, th_end, 60)
    arc = np.column_stack((foot_r - edge + edge * np.cos(arc_t), edge + edge * np.sin(arc_t)))
    edge_r, edge_z = arc[-1]

    z_join = zb + 0.040
    z0 = zb - wall
    zs = np.linspace(edge_z, z_join, 6000)
    # The flare term is not quite zero down at the foot; take it off there so
    # this curve starts exactly on the end of the edge arc.
    flare_at_foot = flare * math.exp((edge_z - z0) / flare_len)
    stem = (stem_r + (edge_r - stem_r - flare_at_foot) * np.exp(-(zs - edge_z) / foot_fall)
            + flare * np.exp(np.minimum(zs - z0, 0.0) / flare_len))
    bowl = np.interp(zs, outer[:, 1], outer[:, 0], left=0.0)
    h = np.maximum(blend - np.abs(stem - bowl), 0.0) / blend
    lower = np.column_stack((np.maximum(stem, bowl) + h * h * blend / 4.0, zs))

    upper = outer[outer[:, 1] > z_join]
    centre = 0.5 * (inner[-1] + outer[-1])
    a0 = math.atan2(normal[-1, 1], normal[-1, 0])
    rim_t = np.linspace(a0, a0 + math.pi, 60)
    rim = centre + 0.5 * wall * np.column_stack((np.cos(rim_t), np.sin(rim_t)))

    dense = np.vstack((
        np.column_stack((np.linspace(0.0, foot_r - edge, 40), np.zeros(40))),
        arc, lower, upper, rim, inner[::-1],
    ))
    info = {
        "height": float(dense[:, 1].max()),
        "wall": wall,
        "foot_diameter": 2 * foot_r,
        "bowl_diameter": float(2 * dense[:, 0].max()),
    }
    return dense, info


def build_wineglass():
    dense, info = wineglass_profile()
    profile = resample_profile(dense, max_len=0.0075, max_angle_deg=17.0, count=92)
    print("  wineglass: height %.4f m, wall %.2f %% of height, bowl dia %.4f, foot dia %.4f, %d profile points"
          % (info["height"], 100.0 * info["wall"] / info["height"], info["bowl_diameter"],
             info["foot_diameter"], len(profile)))
    return lathe(profile, 48)


# --------------------------------------------------------------------------
# Tumbler
# --------------------------------------------------------------------------

def build_tumbler():
    height = 0.092
    r_bottom = 0.0365
    r_top = 0.0425
    base = 0.0140          # solid base, about 15 % of the height
    wall = 0.0036
    slope = (r_top - r_bottom) / height
    wall_h = wall * math.hypot(1.0, slope)   # wall thickness measured horizontally
    r_in_base = r_bottom + slope * base - wall_h
    rim = 0.498 * wall_h
    corners = [(0.0, 0.0), (r_bottom, 0.0), (r_top, height), (r_top - wall_h, height),
               (r_in_base, base), (0.0, base)]
    radii = [0.0, 0.0055, rim, rim, 0.0065, 0.0]
    dense = fillet_polyline(corners, radii)
    profile = resample_profile(dense, max_len=0.0075, max_angle_deg=14.0)
    print("  tumbler: height %.4f m, base %.1f %% of height, wall %.4f m, %d profile points"
          % (height, 100.0 * base / height, wall, len(profile)))
    return lathe(profile, 48)


# --------------------------------------------------------------------------
# Trefoil knot
# --------------------------------------------------------------------------

def build_knot():
    """(2,3) torus knot swept with a round tube. The curve lies on a torus, so
    the torus surface normal is a twist-free, exactly periodic frame vector."""
    n_u, n_v = 256, 20
    major, minor, tube, scale = 2.0, 1.0, 0.5, 0.02
    bm = bmesh.new()
    rings = []
    for i in range(n_u):
        t = 2.0 * math.pi * i / n_u
        c2, s2, c3, s3 = math.cos(2 * t), math.sin(2 * t), math.cos(3 * t), math.sin(3 * t)
        rad = major + minor * c3
        p = Vector((rad * c2, rad * s2, minor * s3))
        dp = Vector((-3 * minor * s3 * c2 - 2 * rad * s2, -3 * minor * s3 * s2 + 2 * rad * c2,
                     3 * minor * c3))
        tangent = dp.normalized()
        normal = Vector((c3 * c2, c3 * s2, s3))
        binormal = tangent.cross(normal).normalized()
        ring = []
        for j in range(n_v):
            a = 2.0 * math.pi * j / n_v
            q = p + tube * (math.cos(a) * normal + math.sin(a) * binormal)
            # Stand the knot upright: its plane becomes Blender XZ (glTF XY),
            # turned a quarter so one lobe is on top and two rest on the ground.
            ring.append(bm.verts.new((-q.y * scale, -q.z * scale, q.x * scale)))
        rings.append(ring)
    for i in range(n_u):
        i2 = (i + 1) % n_u
        for j in range(n_v):
            j2 = (j + 1) % n_v
            bm.faces.new((rings[i][j], rings[i2][j], rings[i2][j2], rings[i][j2]))
    zmin = min(v.co.z for v in bm.verts)
    for v in bm.verts:
        v.co.z -= zmin
    return bm


# --------------------------------------------------------------------------
# Cat figurine
# --------------------------------------------------------------------------

def add_ellipsoid(bm, centre, radii, rot=(0.0, 0.0, 0.0), u=32, v=16):
    m = (Matrix.Translation(Vector(centre)) @ Euler(rot).to_matrix().to_4x4()
         @ Matrix.Diagonal((radii[0], radii[1], radii[2], 1.0)))
    bmesh.ops.create_uvsphere(bm, u_segments=u, v_segments=v, radius=1.0, matrix=m)


def add_chain(bm, points, radii):
    """A tapering round limb: spheres packed along a path, close enough that
    the union is a smooth tube once it has been remeshed."""
    points = [Vector(p) for p in points]
    for i in range(len(points) - 1):
        a, b = points[i], points[i + 1]
        ra, rb = radii[i], radii[i + 1]
        n = max(1, int(math.ceil((b - a).length / (0.2 * min(ra, rb)))))
        for k in range(n + (1 if i == len(points) - 2 else 0)):
            f = k / n
            r = ra + (rb - ra) * f
            add_ellipsoid(bm, a.lerp(b, f), (r, r, r), u=20, v=10)


def object_from_bmesh(bm, name):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def voxel_remesh(obj, voxel):
    """Fuse everything in `obj` into one skin with the voxel remesher (the
    modifier form, which needs no UI context) and return the new mesh."""
    mod = obj.modifiers.new("fuse", "REMESH")
    mod.mode = "VOXEL"
    mod.voxel_size = voxel
    mod.adaptivity = 0.0
    depsgraph = bpy.context.evaluated_depsgraph_get()
    depsgraph.update()
    new = bpy.data.meshes.new_from_object(obj.evaluated_get(depsgraph))
    obj.modifiers.remove(mod)
    return new


def replace_mesh(obj, new):
    old = obj.data
    obj.data = new
    bpy.data.meshes.remove(old)


def mesh_coords(me):
    co = np.empty(len(me.vertices) * 3, dtype=np.float64)
    me.vertices.foreach_get("co", co)
    return co.reshape(-1, 3)


def laplacian_smooth(me, iterations, factor, pin_z=None):
    """Plain umbrella smoothing; `pin_z` is a boolean mask of vertices that
    keep their height (the flat underside of the base)."""
    co = mesh_coords(me)
    nv = len(co)
    ed = np.empty(len(me.edges) * 2, dtype=np.int32)
    me.edges.foreach_get("vertices", ed)
    a, b = ed[0::2], ed[1::2]
    degree = (np.bincount(a, minlength=nv) + np.bincount(b, minlength=nv)).astype(np.float64)
    degree[degree == 0] = 1.0
    for _ in range(iterations):
        new = np.empty_like(co)
        for axis in range(3):
            acc = (np.bincount(a, weights=co[b, axis], minlength=nv)
                   + np.bincount(b, weights=co[a, axis], minlength=nv))
            new[:, axis] = co[:, axis] + factor * (acc / degree - co[:, axis])
        if pin_z is not None:
            new[pin_z, 2] = co[pin_z, 2]
        co = new
    me.vertices.foreach_set("co", co.ravel())
    me.update()


def keep_largest_shell(me):
    """Drop any shell other than the outer skin (sealed pockets between
    overlapping parts would otherwise survive as inside-out bubbles)."""
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.verts.ensure_lookup_table()
    seen = set()
    shells = []
    for v in bm.verts:
        if v.index in seen:
            continue
        stack, shell = [v], []
        seen.add(v.index)
        while stack:
            cur = stack.pop()
            shell.append(cur)
            for e in cur.link_edges:
                o = e.other_vert(cur)
                if o.index not in seen:
                    seen.add(o.index)
                    stack.append(o)
        shells.append(shell)
    shells.sort(key=len, reverse=True)
    dropped = len(shells) - 1
    for shell in shells[1:]:
        bmesh.ops.delete(bm, geom=shell, context="VERTS")
    bm.to_mesh(me)
    bm.free()
    me.update()
    return dropped


def build_cat():
    """Sitting cat on an oval base. Modelled in decimetres facing -Y (which is
    +Z, the front, in glTF), then scaled to metres.

    Stage 1 fuses the soft forms (body, head, legs, tail) with a voxel
    remesh and smooths them hard so the joins melt into each other. Stage 2
    adds the crisp forms (ears and base), fuses again, smooths lightly and
    decimates to the triangle budget."""
    base_top = 0.09
    bm = bmesh.new()

    # Everything that meets the base is sunk well into it, so the fused skin
    # has no hairline gaps under the cat. The belly form fills the space
    # behind the front legs: they read as relief on one solid body.
    # Body: haunches, belly, torso leaning forward, chest, neck.
    add_ellipsoid(bm, (0.0, 0.17, 0.40), (0.38, 0.40, 0.40))
    add_ellipsoid(bm, (0.0, -0.12, 0.42), (0.22, 0.22, 0.42))
    add_ellipsoid(bm, (0.0, 0.02, 0.71), (0.30, 0.30, 0.44), rot=(math.radians(14), 0.0, 0.0))
    add_ellipsoid(bm, (0.0, -0.15, 0.81), (0.25, 0.23, 0.28))
    add_ellipsoid(bm, (0.0, -0.11, 1.05), (0.20, 0.19, 0.18))
    # Head, cheeks, muzzle.
    head_z = 1.26
    add_ellipsoid(bm, (0.0, -0.16, head_z), (0.30, 0.27, 0.235))
    for sx in (-1.0, 1.0):
        add_ellipsoid(bm, (sx * 0.14, -0.28, head_z - 0.06), (0.13, 0.12, 0.11))
    add_ellipsoid(bm, (0.0, -0.385, head_z - 0.065), (0.105, 0.095, 0.075))
    # Legs and paws.
    for sx in (-1.0, 1.0):
        add_chain(bm, [(sx * 0.135, -0.25, 0.79), (sx * 0.135, -0.33, 0.46), (sx * 0.135, -0.36, 0.14)],
                  [0.115, 0.10, 0.095])
        add_ellipsoid(bm, (sx * 0.135, -0.43, 0.15), (0.10, 0.135, 0.09))
        add_ellipsoid(bm, (sx * 0.29, 0.08, 0.33), (0.17, 0.30, 0.30))
        add_ellipsoid(bm, (sx * 0.31, -0.22, 0.14), (0.09, 0.15, 0.08))
    # Tail: lying on the base from the back of the haunches, round the cat's
    # left side (+X) and forward to rest beside the front paws.
    tail_pts, tail_r = [], []
    steps = 44
    for i in range(steps + 1):
        u = i / steps
        phi = math.radians(104.0 - 170.0 * u)
        rho = 0.53 + 0.05 * u
        r = 0.105 - 0.03 * u
        tail_pts.append((rho * math.cos(phi), 0.02 + rho * math.sin(phi), base_top + 0.70 * r))
        tail_r.append(r)
    add_chain(bm, tail_pts, tail_r)

    obj = object_from_bmesh(bm, "cat")
    replace_mesh(obj, voxel_remesh(obj, 0.016))
    laplacian_smooth(obj.data, 30, 0.5)

    # Stage 2: ears and base.
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    for sx in (-1.0, 1.0):
        m = (Matrix.Translation(Vector((sx * 0.175, -0.13, head_z + 0.26)))
             @ Euler((math.radians(4), math.radians(sx * 13), 0.0)).to_matrix().to_4x4()
             @ Matrix.Diagonal((1.0, 0.80, 1.0, 1.0)))
        bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=40,
                              radius1=0.15, radius2=0.035, depth=0.36, matrix=m)
    base_rx, base_ry = 0.60, 0.67
    base_profile = resample_profile(
        fillet_polyline([(0.0, 0.0), (base_rx, 0.0), (base_rx, base_top), (0.0, base_top)],
                        [0.0, 0.035, 0.035, 0.0]),
        max_len=0.05, max_angle_deg=10.0)
    lathe(base_profile, 96, bm=bm,
          matrix=Matrix.Translation(Vector((0.08, 0.01, 0.0))) @ Matrix.Diagonal((1.0, base_ry / base_rx, 1.0, 1.0)))
    bm.to_mesh(obj.data)
    bm.free()

    # Final fuse at a fine voxel size; the triangle budget is met afterwards
    # by decimation, which spends triangles on curvature instead of evenly.
    voxel = 0.02
    replace_mesh(obj, voxel_remesh(obj, voxel))
    dropped = keep_largest_shell(obj.data)
    if dropped:
        print("  cat: removed %d enclosed shell(s)" % dropped)

    # Smooth away the voxel grain, holding the flat underside at its height.
    me = obj.data
    co = mesh_coords(me)
    zmin = co[:, 2].min()
    under = co[:, 2] < zmin + 0.1 * voxel
    print("  cat: underside %d verts, z spread %.2e dm" % (int(under.sum()), float(np.ptp(co[under, 2]))))
    co[under, 2] = zmin
    me.vertices.foreach_set("co", co.ravel())
    laplacian_smooth(me, 8, 0.5, pin_z=under)

    # Reduce to the triangle budget.
    me.calc_loop_triangles()
    before = len(me.loop_triangles)
    mod = obj.modifiers.new("reduce", "DECIMATE")
    mod.decimate_type = "COLLAPSE"
    mod.ratio = 18000.0 / before
    mod.use_collapse_triangulate = True
    depsgraph = bpy.context.evaluated_depsgraph_get()
    depsgraph.update()
    reduced = bpy.data.meshes.new_from_object(obj.evaluated_get(depsgraph))
    obj.modifiers.remove(mod)
    replace_mesh(obj, reduced)
    me = obj.data
    me.calc_loop_triangles()
    print("  cat: voxel %.3f dm gave %d triangles, decimated to %d"
          % (voxel, before, len(me.loop_triangles)))

    co = mesh_coords(me)
    zmin = co[:, 2].min()
    co[co[:, 2] < zmin + 1e-4, 2] = zmin
    co[:, 2] -= zmin
    co *= 0.1
    me.vertices.foreach_set("co", co.ravel())
    me.update()

    bm = bmesh.new()
    bm.from_mesh(me)
    bpy.data.objects.remove(obj)
    bpy.data.meshes.remove(me)
    return bm


# --------------------------------------------------------------------------
# Validation, export, preview
# --------------------------------------------------------------------------

def finish_and_validate(bm, name, tri_range, genus):
    """Triangulate, orient outward and check the mesh. Returns (object, report);
    raises RuntimeError if the mesh is not a closed, outward-facing manifold."""
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    if bm.calc_volume(signed=True) < 0.0:
        bmesh.ops.reverse_faces(bm, faces=bm.faces[:])
    bm.normal_update()
    bm.verts.ensure_lookup_table()
    bm.edges.ensure_lookup_table()
    bm.faces.ensure_lookup_table()
    bm.verts.index_update()
    bm.faces.index_update()

    problems = []
    loose = sum(1 for v in bm.verts if not v.link_faces)
    boundary = sum(1 for e in bm.edges if e.is_boundary)
    wire = sum(1 for e in bm.edges if e.is_wire)
    bad_edges = sum(1 for e in bm.edges if not e.is_manifold)
    two_faced = all(len(e.link_faces) == 2 for e in bm.edges)
    flipped = sum(1 for e in bm.edges if e.is_manifold and not e.is_contiguous)
    bad_verts = sum(1 for v in bm.verts if not v.is_manifold)
    degenerate = sum(1 for f in bm.faces if f.calc_area() < 1e-13)
    volume = bm.calc_volume(signed=True)
    if loose:
        problems.append("%d loose vertices" % loose)
    if boundary:
        problems.append("%d boundary edges" % boundary)
    if wire:
        problems.append("%d wire edges" % wire)
    if bad_edges or not two_faced or not all(e.is_manifold for e in bm.edges):
        problems.append("%d non-manifold edges" % bad_edges)
    if flipped:
        problems.append("%d edges with inconsistent winding" % flipped)
    if bad_verts:
        problems.append("%d non-manifold vertices" % bad_verts)
    if degenerate:
        problems.append("%d degenerate faces" % degenerate)
    if not volume > 0.0:
        problems.append("signed volume %.3e is not positive" % volume)
    # Smooth vertex normals must agree with the faces around them; a folded
    # or creased patch shows up here even when it is topologically sound.
    agreement = 1.0
    for v in bm.verts:
        mean = Vector((0.0, 0.0, 0.0))
        for f in v.link_faces:
            mean += f.normal * f.calc_area()
        if mean.length > 0.0:
            agreement = min(agreement, v.normal.dot(mean.normalized()))
    if agreement < 0.5:
        problems.append("a vertex normal is %.0f degrees off its faces"
                        % math.degrees(math.acos(max(-1.0, min(1.0, agreement)))))

    # One shell only.
    seen = set()
    shells = 0
    for v in bm.verts:
        if v.index in seen:
            continue
        shells += 1
        stack = [v]
        seen.add(v.index)
        while stack:
            cur = stack.pop()
            for e in cur.link_edges:
                o = e.other_vert(cur)
                if o.index not in seen:
                    seen.add(o.index)
                    stack.append(o)
    if shells != 1:
        problems.append("%d separate shells" % shells)
    euler = len(bm.verts) - len(bm.edges) + len(bm.faces)
    if genus is not None and euler != 2 - 2 * genus:
        problems.append("Euler characteristic %d, expected %d" % (euler, 2 - 2 * genus))

    # No surface passing through itself (which would leave interior faces).
    tree = BVHTree.FromBMesh(bm, epsilon=0.0)
    crossing = 0
    for i, j in tree.overlap(tree):
        if i >= j:
            continue
        vi = {v.index for v in bm.faces[i].verts}
        if not any(v.index in vi for v in bm.faces[j].verts):
            crossing += 1
    if crossing:
        problems.append("%d self-intersecting face pairs" % crossing)

    tris = len(bm.faces)
    if not tri_range[0] <= tris <= tri_range[1]:
        problems.append("%d triangles, outside %d-%d" % (tris, tri_range[0], tri_range[1]))

    report = {"verts": len(bm.verts), "tris": tris, "volume": volume, "euler": euler}
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.polygons.foreach_set("use_smooth", [True] * len(me.polygons))
    me.update()
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    if problems:
        raise RuntimeError("%s failed validation: %s" % (name, "; ".join(problems)))
    return obj, report


def export_glb(obj, path):
    for o in bpy.context.scene.objects:
        o.select_set(False)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    wanted = {
        "filepath": path,
        "export_format": "GLB",
        "use_selection": True,
        "export_yup": True,
        "export_apply": True,
        "export_normals": True,
        "export_texcoords": False,
        "export_tangents": False,
        "export_materials": "NONE",
        "export_vertex_color": "NONE",
        "export_all_vertex_colors": False,
        "export_attributes": False,
        "export_animations": False,
        "export_skins": False,
        "export_morph": False,
        "export_cameras": False,
        "export_lights": False,
        "export_extras": False,
        "export_draco_mesh_compression_enable": False,
        "export_copyright": "",
    }
    props = bpy.ops.export_scene.gltf.get_rna_type().properties
    kwargs = {}
    for key, value in wanted.items():
        if key not in props.keys():
            print("  exporter has no parameter %r, skipped" % key)
            continue
        prop = props[key]
        if prop.type == "ENUM":
            valid = [item.identifier for item in prop.enum_items]
            if valid and value not in valid:  # dynamic enums list nothing here
                raise RuntimeError("exporter %s=%r not in %r" % (key, value, valid))
        kwargs[key] = value
    result = bpy.ops.export_scene.gltf(**kwargs)
    if "FINISHED" not in result:
        raise RuntimeError("glTF export of %s returned %r" % (obj.name, result))


def check_glb(path, expected_tris):
    """Re-read the exported file and confirm it carries exactly what the
    renderer expects: triangles with POSITION, NORMAL and indices, nothing else."""
    with open(path, "rb") as fh:
        data = fh.read()
    magic, version, length = struct.unpack_from("<4sII", data, 0)
    if magic != b"glTF" or version != 2 or length != len(data):
        raise RuntimeError("%s: bad GLB header" % path)
    chunk_len, chunk_type = struct.unpack_from("<II", data, 12)
    if chunk_type != 0x4E4F534A:
        raise RuntimeError("%s: first chunk is not JSON" % path)
    doc = json.loads(data[20:20 + chunk_len].decode("utf-8"))
    problems = []
    for key in ("extensionsUsed", "extensionsRequired", "materials", "textures", "images",
                "animations", "cameras", "skins"):
        if doc.get(key):
            problems.append("has %s" % key)
    tris = 0
    lo_y = None
    for mesh in doc.get("meshes", []):
        for prim in mesh["primitives"]:
            if prim.get("mode", 4) != 4:
                problems.append("primitive mode %r" % prim.get("mode"))
            if sorted(prim["attributes"].keys()) != ["NORMAL", "POSITION"]:
                problems.append("attributes %r" % sorted(prim["attributes"].keys()))
            if "indices" not in prim:
                problems.append("no indices")
                continue
            if "material" in prim or "extensions" in prim or "targets" in prim:
                problems.append("primitive carries material, extensions or targets")
            tris += doc["accessors"][prim["indices"]]["count"] // 3
            pos = doc["accessors"][prim["attributes"]["POSITION"]]
            lo_y = pos["min"][1] if lo_y is None else min(lo_y, pos["min"][1])
    if tris != expected_tris:
        problems.append("%d triangles in file, %d in mesh" % (tris, expected_tris))
    if lo_y is None or abs(lo_y) > 1e-5:
        problems.append("base is not on y = 0 (min y %r)" % lo_y)
    if len(data) > MAX_BYTES:
        problems.append("%d bytes, over %d" % (len(data), MAX_BYTES))
    if problems:
        raise RuntimeError("%s: %s" % (os.path.basename(path), "; ".join(problems)))
    return len(data)


def render_preview(obj, name, views, out_dir):
    """Workbench contact sheet: one 512 px tile per view, side by side."""
    scene = bpy.context.scene
    try:
        scene.render.engine = "BLENDER_WORKBENCH"
    except TypeError as err:
        raise RuntimeError("Workbench engine not available: %s" % err)
    shading = scene.display.shading
    shading.light = "STUDIO"
    shading.color_type = "SINGLE"
    shading.single_color = (0.80, 0.80, 0.78)
    shading.show_cavity = True
    shading.show_shadows = False
    shading.show_specular_highlight = True
    if scene.world is None:
        scene.world = bpy.data.worlds.new("preview")
    scene.world.color = (0.16, 0.17, 0.19)
    scene.render.resolution_x = 512
    scene.render.resolution_y = 512
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False
    scene.render.image_settings.file_format = "PNG"

    corners = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
    lo = Vector((min(c[i] for c in corners) for i in range(3)))
    hi = Vector((max(c[i] for c in corners) for i in range(3)))
    centre = 0.5 * (lo + hi)
    radius = 0.5 * (hi - lo).length

    cam_data = bpy.data.cameras.new("preview")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = 2.1 * radius
    cam_data.clip_start = 0.01 * radius
    cam_data.clip_end = 20.0 * radius
    cam = bpy.data.objects.new("preview", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam

    tiles = []
    for index, direction in enumerate(views):
        d = Vector(direction).normalized()
        cam.location = centre + d * 6.0 * radius
        cam.rotation_euler = d.to_track_quat("Z", "Y").to_euler()
        path = os.path.join(out_dir, "_%s_%d.png" % (name, index))
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        img = bpy.data.images.load(path)
        px = np.empty(img.size[0] * img.size[1] * 4, dtype=np.float32)
        img.pixels.foreach_get(px)
        tiles.append(px.reshape(img.size[1], img.size[0], 4))
        bpy.data.images.remove(img)
        os.remove(path)
    sheet = np.hstack(tiles)
    out = bpy.data.images.new("sheet_" + name, sheet.shape[1], sheet.shape[0], alpha=True)
    out.pixels.foreach_set(sheet.ravel())
    out.filepath_raw = os.path.join(out_dir, name + ".png")
    out.file_format = "PNG"
    out.save()
    bpy.data.images.remove(out)
    bpy.data.objects.remove(cam)
    bpy.data.cameras.remove(cam_data)
    print("  preview written: %s.png" % name)


# View directions point from the model towards the camera, in Blender axes
# (Z up, -Y front).
THREE_QUARTER = (1.0, -1.35, 0.85)
SIDE = (1.0, 0.0, 0.0)
FRONT = (0.0, -1.0, 0.0)

MODELS = [
    # name, builder, triangle budget, genus, preview views
    ("wineglass", build_wineglass, (6000, 10000), 0, (THREE_QUARTER, SIDE)),
    ("tumbler", build_tumbler, (3000, 6000), 0, (THREE_QUARTER, SIDE)),
    ("knot", build_knot, (8000, 12000), 1, (THREE_QUARTER, SIDE, FRONT)),
    ("cat", build_cat, (12000, 20000), 0, (THREE_QUARTER, SIDE, FRONT)),
]


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    opts = {"preview": None, "only": None}
    i = 0
    while i < len(argv):
        if argv[i] in ("--preview", "--only") and i + 1 < len(argv):
            opts[argv[i][2:]] = argv[i + 1]
            i += 2
        else:
            raise SystemExit("unknown argument: %s" % argv[i])
    return opts


def main():
    opts = parse_args()
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj)
    os.makedirs(OUT_DIR, exist_ok=True)
    if opts["preview"]:
        os.makedirs(opts["preview"], exist_ok=True)

    failures = []
    summary = []
    for name, builder, tri_range, genus, views in MODELS:
        if opts["only"] and opts["only"] != name:
            continue
        print("building %s" % name)
        obj = None
        try:
            bm = builder()
            obj, report = finish_and_validate(bm, name, tri_range, genus)
            path = os.path.join(OUT_DIR, name + ".glb")
            export_glb(obj, path)
            size = check_glb(path, report["tris"])
            summary.append("%-10s OK  %6d verts  %6d tris  %7d bytes  volume %.3e m3  euler %d"
                           % (name, report["verts"], report["tris"], size, report["volume"],
                              report["euler"]))
        except Exception as err:  # noqa: BLE001 - report every model, then fail
            traceback.print_exc()
            failures.append("%s: %s" % (name, err))
            obj = bpy.data.objects.get(name)
        if obj is not None:
            if opts["preview"]:
                render_preview(obj, name, views, opts["preview"])
            mesh = obj.data
            bpy.data.objects.remove(obj)
            bpy.data.meshes.remove(mesh)

    print("")
    for line in summary:
        print(line)
    if failures:
        for line in failures:
            print("FAILED " + line)
        return 1
    print("all models manifold, outward-facing and exported to public/models")
    return 0


if __name__ == "__main__":
    try:
        code = main()
    except SystemExit:
        raise
    except Exception:  # noqa: BLE001
        traceback.print_exc()
        code = 1
    sys.exit(code)
