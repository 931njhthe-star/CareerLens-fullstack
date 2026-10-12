import * as THREE from 'three';
import {
  PYRAMID_EDGES,
  PYRAMID_FACES,
  PYRAMID_VERTICES,
  pyramidPoints,
  pyramidFraming,
} from './pyramid-geometry.ts';
import type { Point3 } from './pyramid-geometry.ts';

/** Optional colors for the same score geometry and baseline/projected morph. */
export interface ScorePyramidPalette {
  base?: string;
  projected?: string;
  glass?: string;
  edge?: string;
  background?: string;
}

const glassVertex = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vec4 point = modelViewMatrix * vec4(position, 1.0);
    vView = -point.xyz;
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * point;
  }
`;
const glassFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uGlint;
  uniform float uOpacity;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vec3 normal = normalize(vNormal);
    vec3 view = normalize(vView);
    float rim = pow(1.0 - abs(dot(normal, view)), 2.6);
    float light = abs(dot(normal, normalize(vec3(-0.7, 1.0, 1.3))));
    float glint = pow(abs(dot(reflect(-view, normal), normalize(vec3(-0.3, 0.9, 1.0)))), 28.0);
    vec3 color = uColor * (0.54 + light * 0.44) + uGlint * glint * 0.22;
    gl_FragColor = vec4(color, uOpacity * (0.35 + rim * 0.65));
    #include <colorspace_fragment>
  }
`;

const shellVertex = /* glsl */ `
  attribute vec3 barycentric;
  varying vec3 vNormal;
  varying vec3 vView;
  varying vec3 vBarycentric;
  void main() {
    vec4 point = modelViewMatrix * vec4(position, 1.0);
    vView = -point.xyz;
    vNormal = normalize(normalMatrix * normal);
    vBarycentric = barycentric;
    gl_Position = projectionMatrix * point;
  }
`;
const shellFragment = /* glsl */ `
  uniform vec3 uTint;
  uniform vec3 uReflection;
  uniform vec3 uEdge;
  varying vec3 vNormal;
  varying vec3 vView;
  varying vec3 vBarycentric;
  void main() {
    vec3 normal = normalize(vNormal);
    vec3 view = normalize(vView);
    vec3 reflected = reflect(-view, normal);
    float facing = abs(dot(normal, view));
    float fresnel = 0.04 + 0.96 * pow(1.0 - facing, 4.0);

    // Two broad studio reflections travel across the facets as the view turns.
    float key = smoothstep(0.64, 0.99,
      dot(reflected, normalize(vec3(-0.65, 0.8, 1.0))));
    float strip = 1.0 - smoothstep(0.015, 0.19,
      abs(dot(reflected, normalize(vec3(1.0, 0.22, 0.12))) - 0.24));
    strip *= smoothstep(-0.55, 0.6, reflected.y);
    float facet = 0.5 + 0.5 * dot(normal, normalize(vec3(-0.7, 0.8, 0.5)));

    // A narrow bevel-like reflection gives the glass thickness without a heavy frame.
    float edgeDistance = min(vBarycentric.x, min(vBarycentric.y, vBarycentric.z));
    float edge = 1.0 - smoothstep(0.0, 0.025, edgeDistance);
    float catchlight = edge * (0.3 + key * 0.45 + fresnel * 0.25);
    vec3 color = uTint * (0.27 + facet * 0.12)
      + uReflection * (key * 0.35 + strip * 0.18)
      + uEdge * (catchlight * 0.65 + fresnel * 0.18);
    float alpha = 0.07 + fresnel * 0.16 + key * 0.13
      + strip * 0.09 + catchlight * 0.23;
    gl_FragColor = vec4(color, min(alpha, 0.38));
    #include <colorspace_fragment>
  }
`;

function geometry(points: readonly Point3[], order: readonly number[]): THREE.BufferGeometry {
  const result = new THREE.BufferGeometry();
  result.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      order.flatMap((i) => points[i]),
      3,
    ),
  );
  result.computeVertexNormals();
  return result;
}

function glass(color: string, opacity: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: glassVertex,
    fragmentShader: glassFragment,
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uGlint: { value: new THREE.Vector3(0.93, 0.87, 0.73) },
      uOpacity: { value: opacity },
    },
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
}

function glassShell(side: THREE.Side): THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial> {
  const shell = geometry(PYRAMID_VERTICES, PYRAMID_FACES);
  shell.setAttribute(
    'barycentric',
    new THREE.Float32BufferAttribute(
      PYRAMID_FACES.flatMap((_, index) => [
        Number(index % 3 === 0),
        Number(index % 3 === 1),
        Number(index % 3 === 2),
      ]),
      3,
    ),
  );
  return new THREE.Mesh(
    shell,
    new THREE.ShaderMaterial({
      vertexShader: shellVertex,
      fragmentShader: shellFragment,
      uniforms: {
        uTint: { value: new THREE.Color('#cfdfd7') },
        uReflection: { value: new THREE.Vector3(0.88, 0.95, 1.0) },
        uEdge: { value: new THREE.Vector3(0.92, 1.0, 0.95) },
      },
      transparent: true,
      side,
      depthWrite: false,
    }),
  );
}

/** Four score vertices inside a stable, optically quiet glass reference volume. */
export class ScorePyramidRenderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(36, 1, 0.1, 30);
  private readonly assembly = new THREE.Group();
  private readonly surface = glassShell(THREE.BackSide);
  private readonly frontSurface = glassShell(THREE.FrontSide);
  private readonly frame = new THREE.LineSegments(
    geometry(PYRAMID_VERTICES, PYRAMID_EDGES),
    new THREE.LineBasicMaterial({ color: '#dbe8df', transparent: true, opacity: 0.42 }),
  );
  private readonly value = new THREE.Mesh(
    geometry(pyramidPoints([0, 0, 0, 0]), PYRAMID_FACES),
    glass('#deb762', 0.78),
  );
  private readonly edges = new THREE.LineSegments(
    geometry(pyramidPoints([0, 0, 0, 0]), PYRAMID_EDGES),
    new THREE.LineBasicMaterial({ color: '#ebcc8a', transparent: true, opacity: 0.96 }),
  );
  private readonly guides = new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(
      PYRAMID_VERTICES.flatMap((v) => [new THREE.Vector3(), new THREE.Vector3(...v)]),
    ),
    new THREE.LineDashedMaterial({
      color: '#a6b19b',
      transparent: true,
      opacity: 0.2,
      dashSize: 0.035,
      gapSize: 0.06,
    }),
  );
  private readonly markers: THREE.Mesh[] = [];
  private readonly gold = new THREE.Color('#deb762');
  private readonly rose = new THREE.Color('#e77773');
  private width = 1;
  private height = 1;
  private framing?: ReturnType<typeof pyramidFraming>;
  private framingPitch = NaN;

  constructor(canvas: HTMLCanvasElement, palette: ScorePyramidPalette = {}) {
    if (palette.base) this.gold.set(palette.base);
    if (palette.projected) this.rose.set(palette.projected);
    for (const surface of [this.surface, this.frontSurface]) {
      if (palette.glass) {
        surface.material.uniforms.uTint.value = new THREE.Color(palette.glass);
        surface.material.uniforms.uReflection.value = new THREE.Color(palette.glass);
      }
      if (palette.edge) surface.material.uniforms.uEdge.value = new THREE.Color(palette.edge);
    }
    if (palette.edge) {
      this.frame.material.color.set(palette.edge);
      this.guides.material.color.set(palette.edge);
      this.value.material.uniforms.uGlint.value = new THREE.Color(palette.edge);
    }
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      powerPreference: 'low-power',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor(palette.background || '#0b0d0b', palette.background ? 1 : 0);
    this.camera.position.set(0, 0, 5.6);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateMatrixWorld();
    this.guides.computeLineDistances();
    this.surface.renderOrder = 0;
    this.value.renderOrder = 1;
    this.frontSurface.renderOrder = 2;
    this.frame.renderOrder = 3;
    this.edges.renderOrder = 4;
    this.assembly.add(
      this.surface,
      this.guides,
      this.value,
      this.frontSurface,
      this.frame,
      this.edges,
    );
    for (let index = 0; index < 4; index += 1) {
      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(0.022, 10, 8),
        new THREE.MeshBasicMaterial({ color: palette.edge || '#fff0ca' }),
      );
      this.markers.push(marker);
      this.assembly.add(marker);
    }
    this.scene.add(this.assembly);
  }

  resize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.renderer.setSize(this.width, this.height, false);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    this.framing = undefined;
  }

  render(
    scores: readonly number[],
    colorMix: number,
    yaw: number,
    pitch: number,
    zoom: number,
  ): { x: number; y: number; depth: number }[] {
    const points = pyramidPoints(scores);
    for (const [object, order] of [
      [this.value, PYRAMID_FACES],
      [this.edges, PYRAMID_EDGES],
    ] as const) {
      const attribute = object.geometry.getAttribute('position');
      order.forEach((index, vertex) => attribute.setXYZ(vertex, ...points[index]));
      attribute.needsUpdate = true;
      object.geometry.computeBoundingSphere();
    }
    this.value.geometry.computeVertexNormals();
    this.value.material.uniforms.uColor.value.copy(this.gold).lerp(this.rose, colorMix);
    this.edges.material.color.copy(this.gold).lerp(this.rose, colorMix).multiplyScalar(1.12);
    this.markers.forEach((marker, index) => marker.position.set(...points[index]));
    this.assembly.rotation.set(pitch, yaw, 0);
    this.assembly.updateMatrixWorld(true);
    if (!this.framing || pitch !== this.framingPitch) {
      this.framing = pyramidFraming(this.width, this.height, pitch);
      this.framingPitch = pitch;
    }
    const scale = this.framing.scale * Math.max(0.85, Math.min(1.16, zoom));
    this.camera.zoom = (scale * 2 * 5.6 * Math.tan(Math.PI / 10)) / this.height;
    this.camera.updateProjectionMatrix();
    // Center the full rotation envelope rather than the tetrahedron's centroid.
    this.camera.projectionMatrix.elements[9] -= (this.framing.centerY * scale * 2) / this.height;
    this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();
    this.renderer.render(this.scene, this.camera);
    return PYRAMID_VERTICES.map((vertex) => {
      const point = new THREE.Vector3(...vertex)
        .applyMatrix4(this.assembly.matrixWorld)
        .project(this.camera);
      return {
        x: ((point.x + 1) * this.width) / 2,
        y: ((1 - point.y) * this.height) / 2,
        depth: point.z,
      };
    });
  }

  dispose(): void {
    this.assembly.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material) => material.dispose());
      }
    });
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
