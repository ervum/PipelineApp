import {
  DirectionalLight,
  Group,
  HemisphereLight,
  PMREMGenerator,
  Scene,
  Texture,
  WebGLRenderer,
} from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export type LightingRigId = 'studio-3pt' | 'neutral-pbr' | 'outdoor-sun' | 'rim-dramatic';

export interface ActiveLightingRig {
  id: LightingRigId;
  group: Group;
  envTexture: Texture | null;
  dispose: () => void;
}

export const LIGHTING_RIG_OPTIONS: ReadonlyArray<{ id: LightingRigId; label: string }> = [
  { id: 'studio-3pt', label: 'Studio 3-Point' },
  { id: 'neutral-pbr', label: 'Neutral PBR' },
  { id: 'outdoor-sun', label: 'Outdoor Sun' },
  { id: 'rim-dramatic', label: 'Rim Dramatic' },
];

export function applyLightingRig(
  rigId: LightingRigId,
  scene: Scene,
  renderer: WebGLRenderer,
  previous: ActiveLightingRig | null,
): ActiveLightingRig {
  if (previous) {
    previous.dispose();
  }

  const group = new Group();
  group.name = `lighting-rig-${rigId}`;
  let envTexture: Texture | null = null;
  let pmrem: PMREMGenerator | null = null;
  let roomEnv: RoomEnvironment | null = null;

  switch (rigId) {
    case 'studio-3pt': {
      const key = new DirectionalLight(0xffffff, 2.2);
      key.position.set(3, 4, 2);
      key.castShadow = true;
      key.shadow.mapSize.set(1024, 1024);

      const fill = new DirectionalLight(0xdbe4ff, 0.8);
      fill.position.set(-3, 2, 1);

      const rim = new DirectionalLight(0xa5f3fc, 1.6);
      rim.position.set(0, 3, -4);

      const ambient = new HemisphereLight(0xffffff, 0x1f2333, 0.35);

      group.add(key, fill, rim, ambient);
      scene.environment = null;
      break;
    }

    case 'neutral-pbr': {
      pmrem = new PMREMGenerator(renderer);
      roomEnv = new RoomEnvironment();
      const rt = pmrem.fromScene(roomEnv, 0.04);
      envTexture = rt.texture;
      scene.environment = envTexture;
      break;
    }

    case 'outdoor-sun': {
      const hemi = new HemisphereLight(0xbcd7ff, 0x3a2f25, 0.9);
      const sun = new DirectionalLight(0xfff1d6, 3.0);
      sun.position.set(4, 6, 3);
      sun.castShadow = true;
      sun.shadow.mapSize.set(1024, 1024);

      group.add(hemi, sun);
      scene.environment = null;
      break;
    }

    case 'rim-dramatic': {
      const rimViolet = new DirectionalLight(0x7c3aed, 2.5);
      rimViolet.position.set(-3, 2.5, -3);

      const rimCyan = new DirectionalLight(0x06b6d4, 2.5);
      rimCyan.position.set(3, 2.5, -3);

      const dimKey = new DirectionalLight(0xe7e9f3, 0.6);
      dimKey.position.set(1, 3, 4);

      const ambient = new HemisphereLight(0x25293a, 0x090a0f, 0.25);

      group.add(rimViolet, rimCyan, dimKey, ambient);
      scene.environment = null;
      break;
    }
  }

  scene.add(group);

  return {
    id: rigId,
    group,
    envTexture,
    dispose: () => {
      scene.remove(group);
      group.traverse((obj) => {
        if (obj instanceof DirectionalLight && obj.shadow.map) {
          obj.shadow.map.dispose();
        }
      });
      group.clear();
      if (envTexture) {
        if (scene.environment === envTexture) {
          scene.environment = null;
        }
        envTexture.dispose();
      }
      if (roomEnv) {
        roomEnv.dispose();
      }
      if (pmrem) {
        pmrem.dispose();
      }
    },
  };
}
