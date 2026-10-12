import * as THREE from 'three';
import { arc, createStrokes } from './geometry.ts';
import type { Stroke } from './geometry.ts';
import { createAnalysisFibres, fibreGrowthGLSL } from './analysis-fibres.ts';
import type { AnalysisFibre } from './analysis-fibres.ts';
import { analysisFoldScale, analysisViewport } from './analysis-projection.ts';

export const EYE_BACKGROUND = '#080908';

/** Optional presentation colors; omitted entries retain the production artwork. */
export interface AnalysisEyePalette {
  fiber?: string;
  highlight?: string;
  outline?: string;
  background?: string;
  panel?: string;
  text?: string;
}

const fibreVertex = /* glsl */ `
  attribute float aAlong;
  attribute float aSide;
  attribute vec4 aShape;
  attribute vec4 aGrowth;
  attribute float aBrightness;
  uniform float uProgress;
  uniform float uPixelSize;
  varying float vLateral;
  varying float vWidth;
  varying float vAlong;
  varying float vGrowth;
  varying float vBrightness;
  varying float vAngle;
  ${fibreGrowthGLSL}
  void main() {
    float growth = fibreGrowth(uProgress, aGrowth.x, aGrowth.y);
    float along = aAlong * growth;
    vec2 direction = vec2(cos(aShape.x), sin(aShape.x));
    vec2 normal = vec2(-direction.y, direction.x);
    float radius = aShape.y + aShape.z * along;
    float bend = aShape.w * sin(3.14159265359 * along);
    float width = aGrowth.z * mix(1.0, .10, smoothstep(.48, 1.0, aAlong));
    float padding = uPixelSize * .9;
    vec2 point = direction * radius + normal * (bend + (width + padding) * aSide);
    vLateral = (width + padding) * aSide;
    vWidth = width;
    vAlong = aAlong;
    vGrowth = growth;
    vBrightness = aBrightness;
    vAngle = aShape.x;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(point, 0.0, 1.0);
  }
`;
const fibreFragment = /* glsl */ `
  uniform float uReveal;
  uniform float uError;
  uniform float uTipLight;
  uniform float uTime;
  uniform vec3 uFiberColor;
  uniform vec3 uSheenColor;
  uniform vec3 uTipColor;
  varying float vLateral;
  varying float vWidth;
  varying float vAlong;
  varying float vGrowth;
  varying float vBrightness;
  varying float vAngle;
  void main() {
    if (vGrowth <= .00001) discard;
    float feather = max(fwidth(vLateral) * .72, .12);
    float edge = 1.0 - smoothstep(vWidth - feather, vWidth + feather, abs(vLateral));
    float tip = exp(-pow((1.0 - vAlong) * 23.0, 2.0)) * uTipLight;
    float root = mix(.42, .92, smoothstep(0.0, .30, vAlong));
    vec3 champagne = uFiberColor * vBrightness;
    // One restrained light direction gives every hairline a coherent metallic surface.
    float filament = 1.0 - smoothstep(0.0, max(vWidth * .65, .12), abs(vLateral));
    float sheen = pow(.5 + .5 * cos(vAngle * 2.0 - uTime * .16), 4.0);
    champagne += uSheenColor * filament * (.18 + sheen * .46);
    champagne += uTipColor * tip * .75;
    champagne = mix(champagne, vec3(.46, .22, .14), uError);
    gl_FragColor = vec4(champagne, edge * root * uReveal);
    #include <colorspace_fragment>
  }
`;

function fibreGeometry(fibres: AnalysisFibre[]): THREE.BufferGeometry {
  const positions: number[] = [],
    along: number[] = [],
    sides: number[] = [],
    shapes: number[] = [],
    growth: number[] = [],
    brightness: number[] = [],
    indices: number[] = [];
  const steps = 8;
  for (const fibre of fibres) {
    const base = positions.length / 3;
    for (let step = 0; step <= steps; step += 1) {
      for (const side of [-1, 1]) {
        positions.push(0, 0, 0);
        along.push(step / steps);
        sides.push(side);
        shapes.push(fibre.angle, fibre.innerRadius, fibre.length, fibre.bend);
        growth.push(fibre.onset, fibre.easing, fibre.width, 0);
        brightness.push(fibre.brightness);
      }
      if (step < steps) {
        const vertex = base + step * 2;
        indices.push(vertex, vertex + 1, vertex + 2, vertex + 1, vertex + 3, vertex + 2);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  for (const [name, values, size] of [
    ['position', positions, 3],
    ['aAlong', along, 1],
    ['aSide', sides, 1],
    ['aShape', shapes, 4],
    ['aGrowth', growth, 4],
    ['aBrightness', brightness, 1],
  ] as const) {
    geometry.setAttribute(name, new THREE.Float32BufferAttribute(values, size));
  }
  geometry.setIndex(indices);
  return geometry;
}

function outline(transparentSurface: boolean, palette: AnalysisEyePalette): Stroke[] {
  const color = (value: string | undefined, fallback: Stroke['color'], scale = 1): Stroke['color'] => {
    if (!value) return fallback;
    const tint = new THREE.Color(value).multiplyScalar(scale);
    return [tint.r, tint.g, tint.b];
  };
  const boundary = (upper: boolean) =>
    Array.from({ length: 141 }, (_, index): [number, number, number] => {
      const t = index / 140;
      return [
        upper ? -352 + t * 704 : 352 - t * 704,
        Math.sin(t * Math.PI) * (upper ? 182 : -182),
        0,
      ];
    });
  return [
    {
      points: boundary(true),
      start: 0,
      duration: 0.72,
      width: transparentSurface ? 0.88 : 0.58,
      color: color(palette.outline, transparentSurface ? [0.8, 0.83, 0.74] : [0.33, 0.36, 0.31]),
    },
    {
      points: boundary(false),
      start: 0,
      duration: 0.72,
      width: transparentSurface ? 0.88 : 0.58,
      color: color(palette.outline, transparentSurface ? [0.8, 0.83, 0.74] : [0.33, 0.36, 0.31]),
    },
    { points: arc(164), start: 0, duration: 0.72, width: 0.38, color: color(palette.outline, [0.23, 0.25, 0.2], 0.4) },
    {
      points: arc(61),
      start: 0,
      duration: 0.72,
      width: transparentSurface ? 0.72 : 0.45,
      color: color(palette.highlight, transparentSurface ? [0.9, 0.76, 0.45] : [0.34, 0.29, 0.16]),
    },
  ];
}

/** Independent tapered needles in one lightweight pass, without annulus or bloom. */
export class AnalysisEyeRenderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-500, 500, 240, -240, 0.1, 100);
  private readonly eye = new THREE.Group();
  private readonly lines: ReturnType<typeof createStrokes>;
  private readonly fibres = new THREE.Mesh(
    fibreGeometry(createAnalysisFibres(180)),
    new THREE.ShaderMaterial({
      uniforms: {
        uProgress: { value: 0 },
        uReveal: { value: 0 },
        uError: { value: 0 },
        uTipLight: { value: 1 },
        uTime: { value: 0 },
        uPixelSize: { value: 1 },
        uFiberColor: { value: new THREE.Vector3(.72, .49, .20) },
        uSheenColor: { value: new THREE.Vector3(.21, .20, .13) },
        uTipColor: { value: new THREE.Vector3(.29, .27, .18) },
      },
      vertexShader: fibreVertex,
      fragmentShader: fibreFragment,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );

  constructor(
    canvas: HTMLCanvasElement,
    transparentSurface = false,
    descriptors: AnalysisFibre[] = createAnalysisFibres(180),
    palette: AnalysisEyePalette = {},
  ) {
    if (palette.fiber)
      this.fibres.material.uniforms.uFiberColor.value = new THREE.Color(palette.fiber);
    if (palette.highlight) {
      this.fibres.material.uniforms.uSheenColor.value = new THREE.Color(palette.highlight).multiplyScalar(.28);
      this.fibres.material.uniforms.uTipColor.value = new THREE.Color(palette.highlight).multiplyScalar(.36);
    }
    this.fibres.geometry.dispose();
    this.fibres.geometry = fibreGeometry(descriptors);
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: transparentSurface,
      powerPreference: 'low-power',
    });
    this.renderer.setClearColor(palette.background || EYE_BACKGROUND, transparentSurface ? 0 : 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.lines = createStrokes(outline(transparentSurface, palette));
    this.camera.position.z = 10;
    this.fibres.position.z = 1;
    this.fibres.frustumCulled = false;
    this.eye.add(this.lines, this.fibres);
    this.scene.add(this.eye);
  }

  resize(width: number, height: number): void {
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.75);
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height, false);
    const { halfWidth, halfHeight } = analysisViewport(width, height);
    this.fibres.material.uniforms.uPixelSize.value =
      (halfWidth * 2) / Math.max(1, width * pixelRatio);
    this.camera.left = -halfWidth;
    this.camera.right = halfWidth;
    this.camera.top = halfHeight;
    this.camera.bottom = -halfHeight;
    this.camera.updateProjectionMatrix();
  }

  render(
    elapsedMs: number,
    progress: number,
    fold: number,
    reducedMotion: boolean,
    failed: boolean,
  ): void {
    this.lines.material.uniforms.uTime.value = reducedMotion
      ? 0.72
      : Math.min(elapsedMs / 1000, 0.72);
    this.fibres.material.uniforms.uReveal.value = reducedMotion
      ? 1
      : THREE.MathUtils.smoothstep(elapsedMs, 0, 480);
    this.fibres.material.uniforms.uTime.value = reducedMotion || failed ? 0 : elapsedMs / 1000;
    this.fibres.material.uniforms.uProgress.value = progress;
    this.fibres.material.uniforms.uError.value = failed ? 1 : 0;
    this.fibres.material.uniforms.uTipLight.value =
      reducedMotion || failed ? 0 : Math.min(1, (1 - progress) * 50);
    this.eye.scale.y = analysisFoldScale(fold, reducedMotion);
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    for (const object of [this.lines, this.fibres]) {
      object.geometry.dispose();
      object.material.dispose();
    }
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
