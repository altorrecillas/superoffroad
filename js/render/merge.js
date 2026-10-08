// Fewer draw calls: model parts that share a finish are merged into one mesh.
// Each part's material colour moves into the vertex colours, which already hold
// the ambient occlusion baked in Blender.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// merge the child meshes of `group` whose material name matches `test`
export function mergeParts(group, test, params, name) {
  const parts = group.children.filter((m) => m.isMesh && test.test(m.material.name || ''));
  if (parts.length < 2) return;
  const geos = parts.map((m) => {
    const g = m.geometry.clone();
    m.updateMatrix();
    g.applyMatrix4(m.matrix);
    const col = g.attributes.color, c = m.material.color, n = g.attributes.position.count;
    const out = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      const ao = col ? col.getX(i) : 1;
      out[i * 4] = ao * c.r; out[i * 4 + 1] = (col ? col.getY(i) : 1) * c.g; out[i * 4 + 2] = (col ? col.getZ(i) : 1) * c.b; out[i * 4 + 3] = 1;
    }
    g.setAttribute('color', new THREE.BufferAttribute(out, 4));
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k);
    return g;
  });
  const merged = mergeGeometries(geos, false);
  for (const g of geos) g.dispose();
  if (!merged) return;
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, ...params });
  mat.name = name;
  const mesh = new THREE.Mesh(merged, mat);
  mesh.name = name;
  mesh.castShadow = parts.some((m) => m.castShadow); mesh.receiveShadow = true;
  if (parts.some((m) => m.geometry.userData.shared)) { merged.userData.shared = true; mat.userData.shared = true; }
  for (const m of parts) group.remove(m);
  group.add(mesh);
  return mesh;
}
