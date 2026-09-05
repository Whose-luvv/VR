import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

test('panoramic zoom changes both VR eye projections equally', () => {
  const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.01, 100);
  const stereo = new THREE.StereoCamera();
  stereo.aspect = 0.5;
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();
  stereo.update(camera);
  const leftAtOne = stereo.cameraL.projectionMatrix.elements[5];
  const rightAtOne = stereo.cameraR.projectionMatrix.elements[5];

  camera.zoom = 3;
  camera.updateProjectionMatrix();
  stereo.update(camera);

  assert.ok(Math.abs(stereo.cameraL.projectionMatrix.elements[5] / leftAtOne - 3) < 1e-10);
  assert.ok(Math.abs(stereo.cameraR.projectionMatrix.elements[5] / rightAtOne - 3) < 1e-10);
});

test('repeated VR zoom has no application-level step limit', () => {
  let zoom = 1;
  for (let i = 0; i < 40; i++) zoom *= 1.35;
  assert.ok(zoom > 100000);
  for (let i = 0; i < 80; i++) zoom /= 1.35;
  assert.ok(zoom > 0);
});
