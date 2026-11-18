# The Paw: 3D asset contract (for the web app spec)

Approved 18.11.2026. The paw is the centre of the UI: every curse curls one digit, every closed loophole opens one.

## Files
| File | Use | Size |
| --- | --- | --- |
| `paw-web.glb` | desktop (textures 2048 / 2048 / 1024) | 2.9 MB |
| `paw-mobile.glb` | phones and slow networks (1024 / 1024 / 512) | 2.0 MB |
| `paw-poster.jpg` | static fallback while the GLB loads, or when WebGL is missing | 57 KB |
| `runtime-controls.json` | live finger control contract (joints, axes, max angles) | 9 KB |

Both GLBs share one skeleton and identical animation data; only texture resolution differs.

## Coordinate system
glTF Y up. Wrist at the origin, paw exactly 1 unit high, palm facing the camera along +Z. No transforms on the objects.

## Skeleton (16 joints)
`wrist`; `index_mcp`, `index_pip`, `index_dip` (same for `middle`, `ring`, `little`); `thumb_cmc`, `thumb_mcp`, `thumb_ip`. Claws are rigid on their distal joint. Fur, cord and stump are on `wrist`.

## Clips (24 fps)
`rest`, `curl_thumb`, `curl_index`, `curl_middle`, `curl_ring`, `curl_little`, `open_little`, `open_ring`, `open_middle`, `open_index`, `open_thumb`, `sequence` (18 s, the full order, starts and ends at rest).
- Curl = 500 ms, fast attack and quiet settle (a curse landing). Open = 1208 ms, soft (relief).
- Each clip starts from the state its place in the order implies (for example `curl_index` starts with the thumb already tucked).

## The order (binding)
1. The thumb curls first, folded into the lower palm.
2. Then index, middle, ring, little, one at a time, each closing over the thumb. Two digits never move together.
3. Opening is the exact reverse: little, ring, middle, index, and the thumb last.

So for the app: curse n curls digit n in that order (thumb, index, middle, ring, little). When the user closes a loophole, the paw opens the **most recently curled** digit (last in, first out), so the thumb, which sits under the fingers, is always the last to open. The circle that was bound keeps its own seal; only the finger choice is LIFO.

## Live control (instead of, or on top of, clips)
`runtime-controls.json` lists, per joint, the bind-local quaternion, the joint-local axes, the order of operations and the max angles. Every frame: start from the bind rotation, apply `max_degrees * clamp(amount, 0, 1)` per operation in order, never accumulate rotations, and stop competing animation actions on the same joints. It was measured against the original export (its sha256 is inside the file); the web GLBs carry the same skeleton and animation data with smaller textures.

## Look in the app
The model ships with PBR textures (base colour, normal, metallic-roughness). The final look is the Victorian engraving from `docs/ui-brief.md`: an ink cross-hatching shader that uses the normal map for the hatch direction and density, one blood-red accent.

## Credits
Mesh and textures generated with Tripo AI (paid plan, commercial use) from our own concept art, then retopologised to 9,989 quads. Skeleton, weights, clips and audits made in Blender by Shlomicom. Audits on the re-imported file: 0 claw crossings and 0 finger/thumb intersections over 672 animation samples.
