// Campus buildings use opaque, untextured triangle meshes with baked transforms.
const componentArrays = new Map([[5123, Uint16Array], [5125, Uint32Array], [5126, Float32Array]]);
const srgb = value => value <= .0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - .055;

function requireAsset(condition) {
 if (!condition) throw new Error('Unsupported campus GLB');
}

export async function loadCampusGlb(url, origin) {
 const response = await fetch(url);
 if (!response.ok) throw new Error(`GLB request failed (HTTP ${response.status})`);
 const bytes = await response.arrayBuffer();
 const header = new DataView(bytes);
 requireAsset(header.getUint32(0, true) === 0x46546c67 && header.getUint32(4, true) === 2 &&
  header.getUint32(8, true) === bytes.byteLength && header.getUint32(16, true) === 0x4e4f534a);
 const jsonLength = header.getUint32(12, true);
 const asset = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 20, jsonLength)));
 const binaryHeader = 20 + jsonLength;
 const binaryStart = binaryHeader + 8;
 requireAsset(header.getUint32(binaryHeader + 4, true) === 0x004e4942 &&
  binaryStart + header.getUint32(binaryHeader, true) === bytes.byteLength &&
  !asset.extensionsRequired?.length && !asset.buffers[0].uri);

 function readAccessor(index, type, components, allowedTypes) {
  const accessor = asset.accessors[index];
  const view = asset.bufferViews[accessor.bufferView];
  requireAsset(view.buffer === 0 && !accessor.sparse && !view.byteStride &&
   accessor.type === type && allowedTypes.includes(accessor.componentType));
  const ArrayType = componentArrays.get(accessor.componentType);
  const offset = accessor.byteOffset ?? 0;
  const count = accessor.count * components;
  requireAsset(offset + count * ArrayType.BYTES_PER_ELEMENT <= view.byteLength);
  return new ArrayType(bytes, binaryStart + (view.byteOffset ?? 0) + offset, count);
 }

 const vertices = [];
 const bounds = {min:[Infinity, Infinity, Infinity], max:[-Infinity, -Infinity, -Infinity]};
 for (const nodeIndex of asset.scenes[asset.scene ?? 0].nodes) {
  const node = asset.nodes[nodeIndex];
  requireAsset(!node.children && !node.matrix && !node.translation && !node.rotation && !node.scale);
  for (const primitive of asset.meshes[node.mesh].primitives) {
   const material = asset.materials[primitive.material];
   const pbr = material.pbrMetallicRoughness;
   requireAsset((primitive.mode ?? 4) === 4 && !pbr.baseColorTexture &&
    (!material.alphaMode || material.alphaMode === 'OPAQUE'));
   const color = (pbr.baseColorFactor ?? [1, 1, 1]).slice(0, 3).map(srgb);
   const positions = readAccessor(primitive.attributes.POSITION, 'VEC3', 3, [5126]);
   const normals = readAccessor(primitive.attributes.NORMAL, 'VEC3', 3, [5126]);
   const indices = readAccessor(primitive.indices, 'SCALAR', 1, [5123, 5125]);
   requireAsset(positions.length === normals.length && indices.length % 3 === 0);
   for (const index of indices) {
    const start = index * 3;
    requireAsset(start < positions.length);
    for (let axis = 0; axis < 3; axis++) {
     const value = positions[start + axis] + origin[axis];
     bounds.min[axis] = Math.min(bounds.min[axis], value);
     bounds.max[axis] = Math.max(bounds.max[axis], value);
     vertices.push(value);
    }
    vertices.push(normals[start], normals[start + 1], normals[start + 2], ...color);
   }
  }
 }
 requireAsset(vertices.length > 0 && bounds.min.every(Number.isFinite) && bounds.max.every(Number.isFinite));
 return {vertices:new Float32Array(vertices), bounds};
}
