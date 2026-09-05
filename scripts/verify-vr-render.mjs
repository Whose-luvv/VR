import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

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
  await page.click('[data-mode="180"]');
  await page.click('#headset');
  await page.waitForTimeout(800);
  await page.evaluate(()=>window.__vrTest.freeze());
  const beforeState=await page.evaluate(()=>window.__vrTest.getState());
  const before=await page.locator('#scene').screenshot();
  await page.evaluate(()=>{window.__vrTest.zoomIn();window.__vrTest.zoomIn()});
  await page.waitForTimeout(150);
  const afterState=await page.evaluate(()=>window.__vrTest.getState());
  const after=await page.locator('#scene').screenshot();
  assert.equal(beforeState.projection,'180');
  assert.equal(beforeState.layout,'sbs');
  assert.ok(afterState.compositorZoom>beforeState.compositorZoom,`Expected compositor zoom to increase: ${beforeState.compositorZoom} -> ${afterState.compositorZoom}`);
  assert.notDeepEqual(after,before,'Rendered stereo pixels did not change after 180° VR zoom');
  console.log(JSON.stringify({beforeState,afterState,renderedPixelsChanged:true}));
} finally {
  await browser.close();
}
