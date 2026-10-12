export const lineVertex = /* glsl */ `
  attribute float aSide;
  attribute float aWidth;
  attribute float aDistance;
  attribute float aStart;
  attribute float aDuration;
  attribute vec3 aColor;
  varying float vSide;
  varying float vWidth;
  varying float vDistance;
  varying float vStart;
  varying float vDuration;
  varying vec3 vColor;
  void main() {
    vSide = aSide;
    vWidth = aWidth;
    vDistance = aDistance;
    vStart = aStart;
    vDuration = aDuration;
    vColor = aColor;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const lineFragment = /* glsl */ `
  uniform float uTime;
  varying float vSide;
  varying float vWidth;
  varying float vDistance;
  varying float vStart;
  varying float vDuration;
  varying vec3 vColor;
  void main() {
    float clock = clamp((uTime - vStart) / vDuration, 0.0, 1.0);
    float progress = clock * clock * (3.0 - 2.0 * clock);
    if (vDistance > progress || clock <= 0.0) discard;
    float lateral = abs(vSide) * (vWidth + 0.8);
    float feather = max(fwidth(lateral) * 0.65, 0.18);
    float edge = 1.0 - smoothstep(vWidth - feather, vWidth + feather, lateral);
    float age = max(0.0, progress - vDistance) * vDuration;
    float drawing = 1.0 - smoothstep(0.95, 1.0, clock);
    float tip = exp(-age * 72.0) * drawing;
    // Every connection and drawing tip is white; gold belongs to the résumé.
    vec3 color = vColor + vec3(2.4) * tip;
    gl_FragColor = vec4(color, edge);
  }
`;

export const pointVertex = /* glsl */ `
  uniform float uTime;
  uniform float uPixelRatio;
  uniform float uHighlight;
  uniform float uPointSize;
  attribute float aIndex;
  varying float vActive;
  varying float vOpacity;
  void main() {
    vActive = abs(aIndex - uHighlight) < 0.1 ? 1.0 : 0.0;
    vOpacity = smoothstep(0.7, 1.02, uTime);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = (uPointSize + vActive * 2.0) * uPixelRatio;
  }
`;

export const pointFragment = /* glsl */ `
  varying float vActive;
  varying float vOpacity;
  void main() {
    float radius = length(gl_PointCoord - 0.5) * 2.0;
    if (radius > 1.0) discard;
    float alpha = 1.0 - smoothstep(0.35, 0.95, radius);
    gl_FragColor = vec4(vec3(0.94 + vActive * 0.12), alpha * vOpacity);
  }
`;

export const glowFragment = /* glsl */ `
  uniform float uTime;
  varying vec2 vUv;
  void main() {
    float radius = length(vUv - 0.5) * 2.0;
    float aura = exp(-radius * radius * 5.0) * 0.08;
    float halo = exp(-radius * radius * 32.0) * 0.35;
    float core = exp(-radius * radius * 430.0) * 5.0;
    float born = smoothstep(0.0, 0.35, uTime);
    vec3 color = vec3(1.0, 0.73, 0.12) * (aura + halo);
    color += vec3(1.0, 0.97, 0.7) * core;
    gl_FragColor = vec4(color * born, 1.0);
  }
`;

export const screenVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const finishShader = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: screenVertex,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    varying vec2 vUv;
    void main() {
      vec3 color = texture2D(tDiffuse, vUv).rgb;
      float vignette = 1.0 - smoothstep(0.2, 0.85, length(vUv - 0.5)) * 0.42;
      float grain = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
      gl_FragColor = vec4(max(color * vignette + grain * 0.0008, 0.0), 1.0);
    }
  `,
};
