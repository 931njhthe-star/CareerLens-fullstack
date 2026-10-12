// Approved in the design lab: porcelain / studio / sapphire / crystal / orbit.
// Presentation constants only; report data and scoring remain independent.
export const selectedDesign = Object.freeze({
  theme: 'porcelain',
  layout: 'studio',
  eye: 'sapphire',
  pyramid: 'crystal',
  effect: 'orbit',
});

// Legacy/lab gauge selection; production uses the shared fixed-position v8 painter.
// Both legacy renderers are retained in the checked-in matching-eye bundle.
export const analysisEyeGauge = 'radial';

export const analysisEyePalette = Object.freeze({
  fiber: '#2056bf',
  highlight: '#9ad6ff',
  outline: '#365b91',
  background: '#f4f8ff',
  panel: '#ffffff',
  text: '#17335b',
});

export const scorePyramidPalette = Object.freeze({
  base: '#3677e4',
  projected: '#72c8f5',
  glass: '#d9ecff',
  edge: '#8bacd2',
  background: '#edf5ff',
});

export const reportTransitionPalette = Object.freeze({
  primary: '#377bed',
  secondary: '#98d6ff',
  glow: '#ffffff',
  style: 'orbit',
});
