import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { clampPanoZoom, panoSpanForZoom } from '../src/zoom.js';

const sphere = (zoom) => {
  const [thetaStart, thetaLength] = panoSpanForZoom(0, Math.PI, zoom);
  const [phiStart, phiLength] = panoSpanForZoom(Math.PI, Math.PI, zoom);
  return new THREE.SphereGeometry(10, 64, 36, phiStart, phiLength, thetaStart, thetaLength);
};

test('180° geometry at 1× still covers the original hemisphere', () => {
  const p = sphere(1).parameters;
  assert.equal(p.phiStart, Math.PI);
  assert.equal(p.phiLength, Math.PI);
  assert.equal(p.thetaStart, 0);
  assert.equal(p.thetaLength, Math.PI);
});

test('panoramic zoom shrinks the arc uniformly and keeps it centred', () => {
  const base = sphere(1).parameters;
  const zoomed = sphere(3).parameters;
  assert.ok(Math.abs(base.phiLength / zoomed.phiLength - 3) < 1e-12);
  assert.ok(Math.abs(base.thetaLength / zoomed.thetaLength - 3) < 1e-12);
  const center = (p) => [p.phiStart + p.phiLength / 2, p.thetaStart + p.thetaLength / 2];
  const [basePhi, baseTheta] = center(base);
  const [zoomPhi, zoomTheta] = center(zoomed);
  assert.ok(Math.abs(basePhi - zoomPhi) < 1e-12);
  assert.ok(Math.abs(baseTheta - zoomTheta) < 1e-12);
});

test('360° zoom magnifies without exceeding a full sphere', () => {
  const [, full] = panoSpanForZoom(0, Math.PI * 2, 1);
  assert.equal(full, Math.PI * 2);
  const [start, length] = panoSpanForZoom(0, Math.PI * 2, 0.4);
  assert.equal(length, Math.PI * 2, 'zooming out past 1× cannot widen past the full sphere');
  assert.equal(start, 0);
});

test('repeated VR zoom has no application-level step limit', () => {
  let zoom = 1;
  for (let i = 0; i < 40; i++) zoom = clampPanoZoom(zoom * 1.35);
  assert.ok(zoom > 100000);
  assert.ok(panoSpanForZoom(0, Math.PI * 2, zoom)[1] > 0);
  for (let i = 0; i < 80; i++) zoom = clampPanoZoom(zoom / 1.35);
  assert.equal(zoom, 1);
});
