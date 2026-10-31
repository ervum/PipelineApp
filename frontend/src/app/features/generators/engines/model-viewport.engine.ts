import {
  ACESFilmicToneMapping,
  Box3,
  GridHelper,
  Material,
  Mesh,
  Object3D,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  SRGBColorSpace,
  Scene,
  ShadowMaterial,
  Texture,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { ActiveLightingRig, LightingRigId, applyLightingRig } from './lighting-rigs';

export interface ModelStats {
  triangles: number;
  vertices: number;
  materials: number;
  textures: number;
  size: [number, number, number];
}

interface WireframePropertyMaterial extends Material {
  wireframe?: boolean;
}

const TEXTURE_MAP_KEYS = [
  'map',
  'normalMap',
  'roughnessMap',
  'metalnessMap',
  'aoMap',
  'emissiveMap',
] as const;

export class ModelViewportEngine {
  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: WebGLRenderer;
  private readonly scene: Scene;
  private readonly camera: PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly gridHelper: GridHelper;
  private readonly shadowPlane: Mesh;
  private readonly gltfLoader: GLTFLoader;
  private readonly dracoLoader: DRACOLoader;
  private readonly objLoader: OBJLoader;
  private readonly fbxLoader: FBXLoader;

  private activeRig: ActiveLightingRig | null = null;
  private currentModel: Object3D | null = null;
  private originalMaterials = new Map<Mesh, Material | Material[]>();
  private wireframeClones = new Map<Mesh, Material | Material[]>();
  private isWireframe = false;
  private isVisible = true;
  private isDisposed = false;

  private defaultCameraPos = new Vector3(2.4, 1.8, 2.4);
  private defaultTarget = new Vector3(0, 0.5, 0);

  private resizeObserver: ResizeObserver | null = null;
  private intersectionObserver: IntersectionObserver | null = null;

  constructor(canvas: HTMLCanvasElement, opts: { compact: boolean }) {
    this.canvas = canvas;
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
    });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = !opts.compact;
    this.renderer.shadowMap.type = PCFSoftShadowMap;

    this.scene = new Scene();

    const width = Math.max(1, canvas.clientWidth || 320);
    const height = Math.max(1, canvas.clientHeight || 240);
    this.camera = new PerspectiveCamera(40, width / height, 0.01, 1000);
    this.camera.position.copy(this.defaultCameraPos);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.screenSpacePanning = true;
    this.controls.autoRotate = false;
    this.controls.autoRotateSpeed = 1.5;
    this.controls.target.copy(this.defaultTarget);
    this.controls.update();

    this.gridHelper = new GridHelper(10, 20, 0x343a52, 0x25293a);
    this.scene.add(this.gridHelper);

    const planeGeo = new PlaneGeometry(20, 20);
    planeGeo.rotateX(-Math.PI / 2);
    const shadowMat = new ShadowMaterial({ opacity: 0.25 });
    this.shadowPlane = new Mesh(planeGeo, shadowMat);
    this.shadowPlane.receiveShadow = true;
    this.shadowPlane.position.y = -0.001;
    this.scene.add(this.shadowPlane);

    this.activeRig = applyLightingRig('studio-3pt', this.scene, this.renderer, null);

    this.dracoLoader = new DRACOLoader();
    this.dracoLoader.setDecoderPath('assets/draco/');
    this.gltfLoader = new GLTFLoader();
    this.gltfLoader.setDRACOLoader(this.dracoLoader);
    this.objLoader = new OBJLoader();
    this.fbxLoader = new FBXLoader();

    this.setupObservers();
    this.syncSize();
    this.startLoop();
  }

  async load(
    url: string,
    format: 'glb' | 'gltf' | 'obj' | 'fbx',
    onProgress: (p: number) => void,
  ): Promise<ModelStats> {
    this.clearCurrentModel();
    onProgress(5);

    const handleProgress = (evt: ProgressEvent<EventTarget>): void => {
      if (evt.lengthComputable && evt.total > 0) {
        onProgress(Math.min(98, Math.round((evt.loaded / evt.total) * 100)));
      }
    };

    let root: Object3D;
    if (format === 'glb' || format === 'gltf') {
      const gltf = await new Promise<{ scene: Object3D }>((resolve, reject) => {
        this.gltfLoader.load(url, resolve, handleProgress, reject);
      });
      root = gltf.scene;
    } else if (format === 'obj') {
      root = await new Promise<Object3D>((resolve, reject) => {
        this.objLoader.load(url, resolve, handleProgress, reject);
      });
    } else {
      root = await new Promise<Object3D>((resolve, reject) => {
        this.fbxLoader.load(url, resolve, handleProgress, reject);
      });
    }

    if (this.isDisposed) {
      this.disposeObject(root);
      return { triangles: 0, vertices: 0, materials: 0, textures: 0, size: [0, 0, 0] };
    }

    // Center model at origin and place bottom at y = 0
    const initialBox = new Box3().setFromObject(root);
    const sizeVec = new Vector3();
    const centerVec = new Vector3();
    initialBox.getSize(sizeVec);
    initialBox.getCenter(centerVec);

    root.position.x -= centerVec.x;
    root.position.z -= centerVec.z;
    root.position.y -= initialBox.min.y;
    root.updateMatrixWorld(true);

    const framedBox = new Box3().setFromObject(root);
    const framedCenter = new Vector3();
    framedBox.getCenter(framedCenter);

    const maxDim = Math.max(sizeVec.x, sizeVec.y, sizeVec.z, 0.25);
    const fovRad = (this.camera.fov * Math.PI) / 180;
    const distance = (maxDim / (2 * Math.tan(fovRad / 2))) * 1.6;

    this.defaultTarget.copy(framedCenter);
    this.defaultCameraPos.set(
      framedCenter.x + distance * 0.72,
      framedCenter.y + distance * 0.45,
      framedCenter.z + distance * 0.72,
    );
    this.resetCamera();

    const stats = this.collectStatsAndMaterials(root, sizeVec);

    this.currentModel = root;
    this.scene.add(root);

    if (this.isWireframe) {
      this.applyWireframeToCurrentModel(true);
    }

    onProgress(100);
    return stats;
  }

  setWireframe(on: boolean): void {
    this.isWireframe = on;
    this.applyWireframeToCurrentModel(on);
  }

  setGrid(on: boolean): void {
    this.gridHelper.visible = on;
    this.shadowPlane.visible = on;
  }

  setAutoRotate(on: boolean): void {
    this.controls.autoRotate = on;
  }

  setLightingRig(rig: LightingRigId): void {
    this.activeRig = applyLightingRig(rig, this.scene, this.renderer, this.activeRig);
  }

  resetCamera(): void {
    this.camera.position.copy(this.defaultCameraPos);
    this.controls.target.copy(this.defaultTarget);
    this.controls.update();
  }

  screenshot(): Promise<Blob> {
    this.renderer.render(this.scene, this.camera);
    return new Promise<Blob>((resolve, reject) => {
      this.canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Failed to capture viewport screenshot'));
        }
      }, 'image/png');
    });
  }

  dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;
    this.renderer.setAnimationLoop(null);

    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    if (this.intersectionObserver) {
      this.intersectionObserver.disconnect();
      this.intersectionObserver = null;
    }

    this.clearCurrentModel();

    if (this.activeRig) {
      this.activeRig.dispose();
      this.activeRig = null;
    }

    this.gridHelper.geometry.dispose();
    const gridMat = this.gridHelper.material;
    if (Array.isArray(gridMat)) {
      gridMat.forEach((m) => m.dispose());
    } else {
      gridMat.dispose();
    }

    this.shadowPlane.geometry.dispose();
    if (!Array.isArray(this.shadowPlane.material)) {
      this.shadowPlane.material.dispose();
    }

    this.dracoLoader.dispose();
    this.controls.dispose();
    this.renderer.dispose();
  }

  private setupObservers(): void {
    const parent = this.canvas.parentElement;
    if (parent && typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.syncSize());
      this.resizeObserver.observe(parent);
    }

    if (typeof IntersectionObserver !== 'undefined') {
      this.intersectionObserver = new IntersectionObserver(
        (entries) => {
          const entry = entries[0];
          if (!entry) return;
          const visible = entry.isIntersecting;
          if (visible !== this.isVisible) {
            this.isVisible = visible;
            if (visible) {
              this.startLoop();
            } else {
              this.renderer.setAnimationLoop(null);
            }
          }
        },
        { threshold: 0.05 },
      );
      this.intersectionObserver.observe(this.canvas);
    }
  }

  private syncSize(): void {
    if (this.isDisposed) return;
    const parent = this.canvas.parentElement;
    const w = Math.max(1, parent?.clientWidth ?? this.canvas.clientWidth ?? 320);
    const h = Math.max(1, parent?.clientHeight ?? this.canvas.clientHeight ?? 240);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private startLoop(): void {
    if (this.isDisposed) return;
    this.renderer.setAnimationLoop(() => {
      if (!this.isVisible || this.isDisposed) return;
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    });
  }

  private collectStatsAndMaterials(root: Object3D, sizeVec: Vector3): ModelStats {
    let triangles = 0;
    let vertices = 0;
    const uniqueMaterials = new Set<Material>();
    const uniqueTextures = new Set<Texture>();

    this.originalMaterials.clear();
    this.wireframeClones.clear();

    root.traverse((obj) => {
      if (obj instanceof Mesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;

        const geo = obj.geometry;
        if (geo) {
          const posAttr = geo.getAttribute('position');
          if (posAttr) {
            vertices += posAttr.count;
            if (geo.index) {
              triangles += Math.floor(geo.index.count / 3);
            } else {
              triangles += Math.floor(posAttr.count / 3);
            }
          }
        }

        const mat = obj.material as Material | Material[];
        this.originalMaterials.set(obj, mat);
        const matList = Array.isArray(mat) ? mat : [mat];
        for (const m of matList) {
          if (!m) continue;
          uniqueMaterials.add(m);
          const record = m as unknown as Record<string, unknown>;
          for (const key of TEXTURE_MAP_KEYS) {
            const tex = record[key];
            if (tex instanceof Texture) {
              uniqueTextures.add(tex);
            }
          }
        }
      }
    });

    return {
      triangles,
      vertices,
      materials: uniqueMaterials.size,
      textures: uniqueTextures.size,
      size: [
        Number(sizeVec.x.toFixed(2)),
        Number(sizeVec.y.toFixed(2)),
        Number(sizeVec.z.toFixed(2)),
      ],
    };
  }

  private applyWireframeToCurrentModel(on: boolean): void {
    for (const [mesh, orig] of this.originalMaterials.entries()) {
      if (!on) {
        mesh.material = orig;
        continue;
      }

      let cloned = this.wireframeClones.get(mesh);
      if (!cloned) {
        if (Array.isArray(orig)) {
          cloned = orig.map((m) => {
            const c = m.clone() as WireframePropertyMaterial;
            c.wireframe = true;
            return c;
          });
        } else {
          const c = orig.clone() as WireframePropertyMaterial;
          c.wireframe = true;
          cloned = c;
        }
        this.wireframeClones.set(mesh, cloned);
      }
      mesh.material = cloned;
    }
  }

  private clearCurrentModel(): void {
    if (!this.currentModel) return;
    this.scene.remove(this.currentModel);
    for (const cloned of this.wireframeClones.values()) {
      if (Array.isArray(cloned)) {
        cloned.forEach((m) => m.dispose());
      } else {
        cloned.dispose();
      }
    }
    this.wireframeClones.clear();
    this.originalMaterials.clear();
    this.disposeObject(this.currentModel);
    this.currentModel = null;
  }

  private disposeObject(root: Object3D): void {
    root.traverse((obj) => {
      if (obj instanceof Mesh) {
        obj.geometry?.dispose();
        const mat = obj.material as Material | Material[] | undefined;
        const list = Array.isArray(mat) ? mat : mat ? [mat] : [];
        for (const m of list) {
          const record = m as unknown as Record<string, unknown>;
          for (const key of TEXTURE_MAP_KEYS) {
            const tex = record[key];
            if (tex instanceof Texture) {
              tex.dispose();
            }
          }
          m.dispose();
        }
      }
    });
  }
}
