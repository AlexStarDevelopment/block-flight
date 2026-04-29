// Web Worker entry point. Receives {cx, cz} requests and returns greedy-meshed
// chunk arrays as transferable buffers.

import { snapAirportElevations } from './airport';
import { snapLandingSiteElevations } from './landingSites';
import { snapPoiElevations } from './pois';
import { buildMeshArrays, generateChunk } from './chunkData';
import { groundNoiseHeight } from './terrain';

// Workers have a separate module realm — snap airport elevations here too.
// All snaps must run before any chunk gen so terrain knows about every fixture.
snapAirportElevations(groundNoiseHeight);
snapLandingSiteElevations(groundNoiseHeight);
snapPoiElevations(groundNoiseHeight);

interface RequestMsg { id: number; cx: number; cz: number; }

self.onmessage = (e: MessageEvent<RequestMsg>) => {
  const { id, cx, cz } = e.data;
  const data = generateChunk(cx, cz);
  const arrays = buildMeshArrays(data);
  const transfer = [
    arrays.positions.buffer,
    arrays.normals.buffer,
    arrays.colors.buffer,
    arrays.indices.buffer,
  ] as Transferable[];
  (self as unknown as Worker).postMessage(
    {
      id,
      cx: arrays.cx,
      cz: arrays.cz,
      positions: arrays.positions,
      normals: arrays.normals,
      colors: arrays.colors,
      indices: arrays.indices,
    },
    transfer,
  );
};
