import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

// One browser per mode: a second video decode in the same headless browser
// instance never reports metadata in this software-rendering setup.
async function measure(mode) {
  const browser = await chromium.launch({
    executablePath: '/usr/bin/google-chrome',
    headless: true,
    args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--autoplay-policy=no-user-gesture-required']
  });
  try {
    const page = await browser.newPage({viewport:{width:1280,height:720}});
    await page.goto('http://127.0.0.1:5199/?vrtest=1');
    await page.setInputFiles('#file','/tmp/vr-sbs-2k.mp4');
    await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('2048×1024'));
    await page.click(`[data-mode="${mode}"]`);
    await page.click('#headset');
    await page.waitForTimeout(800);
    await page.evaluate(()=>window.__vrTest.freeze());
    const beforeState=await page.evaluate(()=>window.__vrTest.getState());
    const before=await page.locator('#scene').screenshot();
    await page.evaluate(()=>{window.__vrTest.zoomIn();window.__vrTest.zoomIn()});
    await page.waitForTimeout(150);
    const zoomedState=await page.evaluate(()=>window.__vrTest.getState());
    const zoomed=await page.locator('#scene').screenshot();
    await page.evaluate(()=>{window.__vrTest.zoomOut();window.__vrTest.zoomOut()});
    await page.waitForTimeout(150);
    const restoredState=await page.evaluate(()=>window.__vrTest.getState());
    return {beforeState,zoomedState,restoredState,pixelsChanged:!zoomed.equals(before)};
  } finally {
    await browser.close();
  }
}

const results = [];
for (const mode of ['180','360']) {
  const {beforeState,zoomedState,restoredState,pixelsChanged} = await measure(mode);
  const span = (state) => mode === '180' ? state.phiLength180 : state.phiLength360;
  assert.equal(beforeState.projection,mode);
  assert.equal(beforeState.layout,'sbs');
  assert.ok(span(zoomedState) < span(beforeState),`Expected ${mode}° arc to narrow: ${span(beforeState)} -> ${span(zoomedState)}`);
  assert.ok(zoomedState.thetaLength < beforeState.thetaLength,'Expected the vertical arc to narrow too');
  // The picture must magnify through the geometry, not by upscaling eye pixels.
  assert.equal(zoomedState.compositorZoom,1,'Compositor upscale must stay disabled');
  assert.equal(zoomedState.fov,70,'Camera FOV must stay fixed so WebXR projections still match');
  assert.ok(pixelsChanged,`Rendered stereo pixels did not change after ${mode}° VR zoom`);
  assert.ok(Math.abs(span(restoredState)-span(beforeState))<1e-9,'Zoom out did not return to the original field of view');
  results.push({mode,beforeState,zoomedState,restoredState,renderedPixelsChanged:pixelsChanged});
}
console.log(JSON.stringify(results,null,2));
