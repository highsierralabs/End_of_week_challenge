# PURPOSE: An outside check of the machine's solids: load every part of the assembled machine into
#          Blender (headless) and report (a) parts whose mesh is not manifold and (b) every pair of
#          parts whose surfaces cut through each other, at each exported crank position.
# USAGE:   WW_EXPORT_DIR=<dir> npx vitest run tests/unit/assembly-export.test.ts
#          blender --background --factory-startup --python scripts/blender-interference.py -- <dir>
# OUTPUT:  ASCII lines: one per pose with counts, then one per intersecting pair with the number of
#          crossing triangle pairs; "interference: ..." summary last.
# VERSION HISTORY:
#   1.0  2026-11-27  Initial release.
import json
import os
import sys

import bmesh
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

root = sys.argv[sys.argv.index('--') + 1]

# Parts of one rigid body (a wheel and the tube it is pressed on, a pillar and the plate it stands
# in) are fixed to each other and are not tested against each other. Between different bodies the
# only contact meant is the Moon's stalk standing on the inclined ring.
MEANT = {frozenset(('nodeRing', 'moonStalk'))}


def load(path):
    """Read a binary STL into a welded bmesh."""
    import struct
    with open(path, 'rb') as f:
        data = f.read()
    n = struct.unpack_from('<I', data, 80)[0]
    bm = bmesh.new()
    verts = {}
    faces = []
    off = 84
    for _ in range(n):
        vals = struct.unpack_from('<12f', data, off)
        off += 50
        tri = []
        for k in range(3):
            p = vals[3 + 3 * k: 6 + 3 * k]
            key = (round(p[0], 4), round(p[1], 4), round(p[2], 4))
            v = verts.get(key)
            if v is None:
                v = bm.verts.new(p)
                verts[key] = v
            tri.append(v)
        if tri[0] is not tri[1] and tri[1] is not tri[2] and tri[0] is not tri[2]:
            faces.append(tri)
    for tri in faces:
        try:
            bm.faces.new(tri)
        except ValueError:
            pass  # a doubled face where two shells of one part touch
    bm.verts.ensure_lookup_table()
    bm.faces.ensure_lookup_table()
    return bm


total_pairs = 0
total_bad = 0
for pose in sorted(d for d in os.listdir(root) if d.startswith('pose')):
    folder = os.path.join(root, pose)
    manifest = json.load(open(os.path.join(folder, 'manifest.json')))
    parts = []
    nonmanifold = []
    for entry in manifest:
        bm = load(os.path.join(folder, entry['file']))
        bad_edges = sum(1 for e in bm.edges if len(e.link_faces) != 2)
        if bad_edges:
            nonmanifold.append((entry['id'], bad_edges))
        lo = Vector((min(v.co.x for v in bm.verts), min(v.co.y for v in bm.verts), min(v.co.z for v in bm.verts)))
        hi = Vector((max(v.co.x for v in bm.verts), max(v.co.y for v in bm.verts), max(v.co.z for v in bm.verts)))
        parts.append((entry['id'], entry['body'], bm, BVHTree.FromBMesh(bm, epsilon=0.0), lo, hi))
    hits = []
    tested = 0
    for i in range(len(parts)):
        ida, bodya, bma, ta, loa, hia = parts[i]
        for j in range(i + 1, len(parts)):
            idb, bodyb, bmb, tb, lob, hib = parts[j]
            if any(loa[k] > hib[k] or lob[k] > hia[k] for k in range(3)):
                continue
            if bodya == bodyb or frozenset((ida, idb)) in MEANT:
                continue
            tested += 1
            pairs = ta.overlap(tb)
            if not pairs:
                continue
            hits.append((ida, idb, len(pairs)))
    print('%s: %d parts, %d with open edges, %d neighbouring pairs tested, %d cut through each other' % (pose, len(parts), len(nonmanifold), tested, len(hits)))
    for name, n in nonmanifold:
        print('  open edges: %s (%d)' % (name, n))
    for ida, idb, n in sorted(hits, key=lambda h: -h[2]):
        print('  %s x %s: %d crossing triangle pairs' % (ida, idb, n))
    total_pairs += tested
    total_bad += len(hits) + len(nonmanifold)
    for p in parts:
        p[2].free()

print('interference: %s (%d neighbouring pairs tested)' % ('none' if total_bad == 0 else '%d findings' % total_bad, total_pairs))
