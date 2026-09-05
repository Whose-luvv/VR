export function fovForZoom(baseFovDegrees, zoomLevel) {
  const baseHalfRadians = baseFovDegrees * Math.PI / 360;
  return Math.atan(Math.tan(baseHalfRadians) / zoomLevel) * 360 / Math.PI;
}
