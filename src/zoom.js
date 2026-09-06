export function fovForZoom(baseFovDegrees, zoomLevel) {
  const baseHalfRadians = baseFovDegrees * Math.PI / 360;
  return Math.atan(Math.tan(baseHalfRadians) / zoomLevel) * 360 / Math.PI;
}

// Panoramic zoom is done on the geometry, not on the camera or the compositor.
// A headset's field of view is fixed by the device, and under WebXR the
// projection matrices come from the runtime, so neither camera.fov nor a
// post-process upscale can magnify the picture there. Mapping the same video
// across a narrower slice of sphere magnifies it in every render path (desktop,
// cardboard stereo and native WebXR) at full source resolution.
export const MIN_PANO_ZOOM = 1;

export function clampPanoZoom(zoomLevel) {
  return Math.max(MIN_PANO_ZOOM, zoomLevel);
}

// Returns [start, length] for an arc of `baseLength` that stays centred on the
// same direction as it shrinks.
export function panoSpanForZoom(baseStart, baseLength, zoomLevel) {
  const length = baseLength / clampPanoZoom(zoomLevel);
  return [baseStart + (baseLength - length) / 2, length];
}
