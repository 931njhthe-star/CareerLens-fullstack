import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CONNECTION_DURATION, CONNECTION_START } from './data.ts';
import type { MatchingData, MatchingJob } from './data.ts';
import { arc, createJobPoints, createStrokes, eyeBoundary } from './geometry.ts';
import type { Position, Stroke } from './geometry.ts';
import { finishShader, glowFragment, screenVertex } from './shaders.ts';

export function makeEyeStrokes(data: MatchingData): Stroke[] {
  const strokes: Stroke[] = [];
  const add = (
    points: Position[],
    start: number,
    duration: number,
    width: number,
    brightness: number,
  ) =>
    strokes.push({
      points,
      start,
      duration,
      width,
      color: [brightness, brightness, brightness],
    });

  add(eyeBoundary(true), 0.08, 0.61, 0.9, 0.46);
  add(eyeBoundary(false), 0.23, 0.61, 0.9, 0.46);
  add(arc(215), 0.27, 0.65, 0.7, 0.35);
  add(arc(208), 0.36, 0.64, 0.45, 0.24);
  add(arc(62), 0.08, 0.53, 0.45, 0.3);
  add(arc(46), 0.08, 0.53, 0.35, 0.21);

  // Structural strokes, not synthetic job nodes or synthetic match connections.
  const fibreCount = 168;
  for (let index = 0; index < fibreCount; index += 1) {
    const angle = ((index + Math.sin(index * 3.71) * 0.32) / fibreCount) * Math.PI * 2;
    const texture = (Math.sin(index * 31.7) + 1) / 2;
    const inner = 67 + texture * 19;
    const outer = 188 + Math.sin(index * 12.41) * 15;
    add(
      [
        [Math.cos(angle) * inner, Math.sin(angle) * inner, 0],
        [Math.cos(angle) * outer, Math.sin(angle) * outer, 0],
      ],
      0.44 + (index / fibreCount) * 0.25,
      0.36,
      0.23,
      0.026 + texture * 0.028,
    );
  }

  for (let index = 0; index < 96; index += 1) {
    const angle = (index / 96) * Math.PI * 2;
    const length = index % 8 === 0 ? 10 : 4;
    add(
      [
        [Math.cos(angle) * 219, Math.sin(angle) * 219, 0],
        [Math.cos(angle) * (219 + length), Math.sin(angle) * (219 + length), 0],
      ],
      0.38 + (index / 96) * 0.31,
      0.18,
      0.35,
      index % 8 === 0 ? 0.32 : 0.16,
    );
  }

  for (const job of data.jobs) {
    if (!job.matched) continue;
    // One shared clock starts every qualifying white ray at precisely the same time.
    add(
      [
        [0, 0, 1],
        [job.x, job.y, 1],
      ],
      CONNECTION_START,
      CONNECTION_DURATION,
      0.7,
      0.72,
    );
  }
  return strokes;
}

export class MatchingEyeRenderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-500, 500, 285, -285, 0.1, 100);
  private readonly composer: EffectComposer;
  private readonly lines: ReturnType<typeof createStrokes>;
  private readonly points: ReturnType<typeof createJobPoints>;
  private readonly glow: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private width = 1;
  private height = 1;
  private halfWidth = 500;
  private halfHeight = 285;

  constructor(
    canvas: HTMLCanvasElement,
    private readonly data: MatchingData,
  ) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'low-power',
    });
    this.renderer.setClearColor('#080908');
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.camera.position.z = 10;

    this.lines = createStrokes(makeEyeStrokes(data));
    this.points = createJobPoints(data.jobs);
    this.glow = new THREE.Mesh(
      new THREE.PlaneGeometry(150, 150),
      new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 } },
        vertexShader: screenVertex,
        fragmentShader: glowFragment,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.glow.position.z = 2;
    this.scene.add(this.lines, this.glow, this.points);

    const target = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      samples: 2,
    });
    this.composer = new EffectComposer(this.renderer, target);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(1, 1), 0.5, 0.35, 1.1));
    this.composer.addPass(new ShaderPass(finishShader));
    this.composer.addPass(new OutputPass());
  }

  resize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(this.width, this.height, false);
    this.composer.setPixelRatio(ratio);
    this.composer.setSize(this.width, this.height);
    this.points.material.uniforms.uPixelRatio.value = ratio;
    this.points.material.uniforms.uPointSize.value = Math.max(
      1.6,
      3.5 * Math.sqrt(85 / Math.max(85, this.data.jobs.length)),
    );

    const aspect = this.width / this.height;
    this.halfWidth = Math.max(482, 258 * aspect);
    this.halfHeight = this.halfWidth / aspect;
    this.camera.left = -this.halfWidth;
    this.camera.right = this.halfWidth;
    this.camera.top = this.halfHeight;
    this.camera.bottom = -this.halfHeight;
    this.camera.updateProjectionMatrix();
  }

  render(time: number): void {
    this.lines.material.uniforms.uTime.value = time;
    this.points.material.uniforms.uTime.value = time;
    this.glow.material.uniforms.uTime.value = time;
    this.composer.render();
  }

  highlight(id: string | null): void {
    this.points.material.uniforms.uHighlight.value = this.data.jobs.findIndex(
      (job) => job.id === id,
    );
  }

  pick(clientX: number, clientY: number): MatchingJob | null {
    let nearest: MatchingJob | null = null;
    let distance = 11;
    for (const job of this.data.jobs) {
      const x = ((job.x / this.halfWidth + 1) * this.width) / 2;
      const y = ((1 - job.y / this.halfHeight) * this.height) / 2;
      const current = Math.hypot(x - clientX, y - clientY);
      if (current < distance) {
        nearest = job;
        distance = current;
      }
    }
    return nearest;
  }

  dispose(): void {
    for (const object of [this.lines, this.points, this.glow]) {
      object.geometry.dispose();
      object.material.dispose();
    }
    for (const pass of this.composer.passes) pass.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
