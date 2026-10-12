const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

/** Place the five branches below navigation, within the actual viewport's content area. */
export function liveJourneyGeometry(viewport, origin) {
  const { width, height, scale, offsetX, offsetY, centerX, centerY } = viewport;
  const toScene = ({ x, y }) => ({ x: (x - offsetX) / scale, y: (y - offsetY) / scale });
  const start = origin
    ? { x: offsetX + origin.x * scale, y: offsetY + origin.y * scale }
    : { x: width * 0.08, y: centerY + 40 };
  let fork, destinations;
  if (width <= 1000) {
    const top = clamp(start.y - 56, Math.min(180, height * 0.4), Math.max(180, height - 270));
    const bottom = Math.max(top + 90, Math.min(height - 96, top + 210));
    const span = bottom - top;
    fork = { x: width * 0.25, y: top + span * 0.52 };
    destinations = [
      { x: width * 0.46, y: top },
      { x: width * 0.69, y: top + span * 0.16 },
      { x: width * 0.76, y: top + span * 0.48 },
      { x: width * 0.67, y: top + span * 0.79 },
      { x: width * 0.45, y: bottom },
    ];
  } else {
    const top = Math.max(centerY - 10 * scale, start.y - 45 * scale);
    fork = { x: centerX - 200 * scale, y: top + 110 * scale };
    destinations = [
      { x: centerX + 30 * scale, y: top },
      { x: centerX + 230 * scale, y: top + 20 * scale },
      { x: centerX + 355 * scale, y: top + 112 * scale },
      { x: centerX + 230 * scale, y: top + 210 * scale },
      { x: centerX + 30 * scale, y: top + 220 * scale },
    ];
  }
  return {
    fork: toScene(fork),
    destinations: destinations.map(toScene),
    labelScale: Math.max(1, 0.75 / scale),
    labelRight: (width - 24 - offsetX) / scale,
  };
}
