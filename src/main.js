import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { fovForZoom } from './zoom.js';
import './style.css';

const $ = (s) => document.querySelector(s);
const canvas = $('#scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
const normalPixelRatio = Math.min(devicePixelRatio, 1.5);
renderer.setPixelRatio(normalPixelRatio);
renderer.setSize(innerWidth, innerHeight);
renderer.xr.enabled = true;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05070b);
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, .01, 100);
camera.position.set(0, 1.6, 0);
scene.add(camera);

const video = document.createElement('video');
video.playsInline = true; video.preload = 'metadata'; video.crossOrigin = 'anonymous';
const texture = new THREE.VideoTexture(video);
texture.colorSpace = THREE.SRGBColorSpace;
texture.minFilter = THREE.LinearFilter; texture.magFilter = THREE.LinearFilter;

let projection = 'flat', layout = 'mono', sourceUrl, active = false, cardboard = false, loadId = 0;
let yaw = 0, pitch = 0, dragging = false, lastX = 0, lastY = 0;
let orientationEnabled = false, baseHeading = null;
let flatZoomLevel = 1, panoZoomLevel = 1;
let controlsUntil = 0, hiddenView = new THREE.Quaternion(), controlsShown = false;
let menuCollapsed = false, drawerUntil = 0, pointerStartX = 0, pointerStartY = 0;
let lastPhysicalActivation = 0;
const contentDirection = new THREE.Quaternion();
const reticleMotionAnchor = new THREE.Quaternion();let reticleUntil = 0;
let vrTestFreeze = false;

const panoMat = new THREE.MeshBasicMaterial({map:texture,side:THREE.BackSide,toneMapped:false});
// Native textured geometry is more reliable for mobile video decoders than a
// custom video fragment shader. The hemisphere maps the full source across 180°.
const sphere = new THREE.Group();
const sphere360 = new THREE.Mesh(new THREE.SphereGeometry(10,48,28),panoMat);
const sphere180 = new THREE.Mesh(new THREE.SphereGeometry(10,48,28,Math.PI,Math.PI),panoMat);
sphere.add(sphere360,sphere180);sphere.visible=false;scene.add(sphere);
const flatMat = new THREE.MeshBasicMaterial({ map:texture, side:THREE.DoubleSide, toneMapped:false });
const screen = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 2.925), flatMat);
screen.position.set(0,1.6,-4); screen.visible=false; scene.add(screen);

// The menu lives in the world. If it were attached to the camera, head movement
// could never move the center ray onto a button.
const ui = new THREE.Group(); scene.add(ui); ui.position.set(0,.55,-2.7); ui.visible=false;
const buttons=[];
function panelTexture(){const c=document.createElement('canvas');c.width=1024;c.height=320;const g=c.getContext('2d');g.shadowColor='#000';g.shadowBlur=24;g.fillStyle='#000000f2';g.roundRect(18,18,988,284,32);g.fill();g.shadowBlur=0;g.strokeStyle='#ffffff30';g.lineWidth=2;g.stroke();g.fillStyle='#a4a4a4';g.font='500 22px system-ui';g.textAlign='center';g.fillText('AIM  •  HOLD OR CLICK',512,60);return new THREE.CanvasTexture(c)}
const controlPanel=new THREE.Mesh(new THREE.PlaneGeometry(4.15,1.3),new THREE.MeshBasicMaterial({map:panelTexture(),transparent:true,depthTest:false,depthWrite:false}));controlPanel.position.set(.2,-.04,-.035);controlPanel.renderOrder=1;ui.add(controlPanel);
function makeLabel(icon,text,action,x,width=.62){
  const c=document.createElement('canvas'); c.width=1024; c.height=320; const g=c.getContext('2d');
  g.fillStyle='#000000';g.roundRect(16,16,992,288,42);g.fill();g.strokeStyle='#ffffff70';g.lineWidth=5;g.stroke();
  g.fillStyle='#ffffff';g.font='700 76px Arial, sans-serif';g.textAlign='center';g.textBaseline='middle';g.fillText(icon,160,160);g.font='700 58px Arial, sans-serif';g.fillText(text,640,160);
  const tex=new THREE.CanvasTexture(c);tex.colorSpace=THREE.SRGBColorSpace;tex.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());tex.minFilter=THREE.LinearMipmapLinearFilter;tex.magFilter=THREE.LinearFilter;const m=new THREE.MeshBasicMaterial({map:tex,transparent:true,depthTest:false,depthWrite:false,color:0xffffff});const mesh=new THREE.Mesh(new THREE.PlaneGeometry(width,.33),m);mesh.position.x=x;mesh.position.z=.01;mesh.renderOrder=2;mesh.userData.action=()=>{mesh.userData.pulseAt=performance.now();action()};mesh.userData.targetScale=1;mesh.userData.dwellMs=900;ui.add(mesh);buttons.push(mesh);return mesh;
}
makeLabel('↶','10s',()=>seek(-10),-1.36,.65); makeLabel('▶','Play',toggle,-.52,.92); makeLabel('↷','10s',()=>seek(10),.38,.65); makeLabel('−','Volume',()=>volume(-.1),1.08,.7); makeLabel('+','Volume',()=>volume(.1),1.78,.7);
makeLabel('−','Zoom',()=>zoom(-.35),-.8,.72);buttons.at(-1).position.y=-.4;makeLabel('+','Zoom',()=>zoom(.35),0,.72);buttons.at(-1).position.y=-.4;makeLabel('◎','Center',recenter,.8,.8);buttons.at(-1).position.y=-.4;
const closeButton=makeLabel('×','Hide',collapseControls,1.68,.68);closeButton.position.y=-.4;
const timelineCanvas=document.createElement('canvas');timelineCanvas.width=1024;timelineCanvas.height=64;const timelineContext=timelineCanvas.getContext('2d');const timelineTexture=new THREE.CanvasTexture(timelineCanvas);timelineTexture.minFilter=THREE.LinearFilter;timelineTexture.magFilter=THREE.LinearFilter;let drawnProgress=-1;
function updateTimeline(fraction){fraction=THREE.MathUtils.clamp(fraction||0,0,1);if(Math.abs(fraction-drawnProgress)<.001)return;drawnProgress=fraction;const g=timelineContext,w=timelineCanvas.width,h=timelineCanvas.height,r=h/2;g.clearRect(0,0,w,h);g.fillStyle='#181818';g.beginPath();g.roundRect(0,0,w,h,r);g.fill();if(fraction>0){g.save();g.beginPath();g.roundRect(0,0,w,h,r);g.clip();g.fillStyle='#ffffff';g.fillRect(0,0,w*fraction,h);g.restore()}timelineTexture.needsUpdate=true}
updateTimeline(0);const progressBg=new THREE.Mesh(new THREE.PlaneGeometry(3.55,.16),new THREE.MeshBasicMaterial({map:timelineTexture,transparent:true,depthTest:false,depthWrite:false}));progressBg.position.set(.2,.38,.006);progressBg.renderOrder=3;ui.add(progressBg);
progressBg.userData.dwellMs=5000;progressBg.userData.noAnimate=true;progressBg.userData.action=()=>{if(video.duration&&Number.isFinite(video.duration)){const fraction=THREE.MathUtils.clamp(progressBg.userData.hitU??0,0,1);video.currentTime=fraction*video.duration;updateTimeline(fraction);toast(`Jumped to ${format(video.currentTime)}`)}};buttons.push(progressBg);
const raycaster=new THREE.Raycaster(), center=new THREE.Vector2(0,0);let hovered=null, hoverAt=0;
const buttonWhite=new THREE.Color(0xffffff),buttonGlow=new THREE.Color(0xd9dde3);
const stereoCamera = new THREE.StereoCamera(); stereoCamera.eyeSep = .064;
const reticleOutline=new THREE.Mesh(new THREE.CircleGeometry(.007,24),new THREE.MeshBasicMaterial({color:0x000000,depthTest:false,depthWrite:false,transparent:true,opacity:.2}));reticleOutline.position.set(0,0,-.802);reticleOutline.renderOrder=1001;camera.add(reticleOutline);reticleOutline.visible=false;
const reticle=new THREE.Mesh(new THREE.CircleGeometry(.004,24),new THREE.MeshBasicMaterial({color:0xffffff,depthTest:false,depthWrite:false,transparent:true,opacity:.3}));reticle.position.set(0,0,-.8);reticle.renderOrder=1002;camera.add(reticle);reticle.visible=false;
const dwell=new THREE.Mesh(new THREE.RingGeometry(.026,.031,32),new THREE.MeshBasicMaterial({color:0xe2e5e9,transparent:true,opacity:0,depthTest:false,depthWrite:false}));dwell.position.set(0,0,-.801);dwell.renderOrder=1000;camera.add(dwell);
function floatingAction(title,subtitle,width){const c=document.createElement('canvas');c.width=640;c.height=180;const g=c.getContext('2d');g.fillStyle='#000000ee';g.roundRect(10,10,620,160,32);g.fill();g.strokeStyle='#ffffff44';g.lineWidth=3;g.stroke();g.fillStyle='#fff';g.font='600 35px system-ui';g.textAlign='center';g.fillText(title,320,78);g.fillStyle='#b1b5bc';g.font='500 24px system-ui';g.fillText(subtitle,320,122);const m=new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(c),transparent:true,opacity:.38,depthTest:false,depthWrite:false});const o=new THREE.Mesh(new THREE.PlaneGeometry(width,.48),m);o.visible=false;o.renderOrder=5;scene.add(o);buttons.push(o);return o}
function drawerAction(){const c=document.createElement('canvas');c.width=c.height=256;const g=c.getContext('2d');g.fillStyle='#000000ee';g.beginPath();g.arc(128,128,108,0,Math.PI*2);g.fill();g.strokeStyle='#ffffff66';g.lineWidth=5;g.stroke();g.fillStyle='#fff';for(let row=-1;row<=1;row++)for(let col=-1;col<=1;col++){g.beginPath();g.arc(128+col*42,128+row*42,10,0,Math.PI*2);g.fill()}const texture=new THREE.CanvasTexture(c);texture.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());const material=new THREE.MeshBasicMaterial({map:texture,transparent:true,opacity:.34,depthTest:false,depthWrite:false});const object=new THREE.Mesh(new THREE.PlaneGeometry(.42,.42),material);object.visible=false;object.renderOrder=5;scene.add(object);buttons.push(object);return object}
const drawer=drawerAction();drawer.userData.action=expandControls;drawer.userData.dwellMs=900;
const bringPrompt=floatingAction('◎  Bring here','Hold or click',1.18);bringPrompt.scale.y=.82;bringPrompt.material.opacity=.58;bringPrompt.userData.action=bringVideoHere;bringPrompt.userData.dwellMs=900;

// Cardboard-style lens correction. Both eyes are rendered first, then warped
// around each physical lens centre to counter the headset's pincushion optics.
const leftTarget=new THREE.WebGLRenderTarget(2,2,{minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter,depthBuffer:true});
const rightTarget=new THREE.WebGLRenderTarget(2,2,{minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter,depthBuffer:true});
const postScene=new THREE.Scene(), postCamera=new THREE.OrthographicCamera(-1,1,1,-1,0,1);
const warpMat=new THREE.ShaderMaterial({depthTest:false,uniforms:{leftMap:{value:leftTarget.texture},rightMap:{value:rightTarget.texture},k:{value:.28},frameDistance:{value:0}},vertexShader:`varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position,1.);}`,fragmentShader:`uniform sampler2D leftMap;uniform sampler2D rightMap;uniform float k;uniform float frameDistance;varying vec2 vUv;void main(){bool rightEye=vUv.x>=.5;float localX=rightEye?(vUv.x-.5)*2.:vUv.x*2.;localX+=rightEye?-frameDistance:frameDistance;vec2 p=vec2(localX*2.-1.,vUv.y*2.-1.);float r2=dot(p,p);vec2 q=p*(1.+k*r2);if(max(abs(q.x),abs(q.y))>1.){gl_FragColor=vec4(0.,0.,0.,1.);return;}vec2 uv=(q+1.)*.5;gl_FragColor=rightEye?texture2D(rightMap,uv):texture2D(leftMap,uv);}`});
postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2),warpMat));

function setEyeTexture(eye=0){texture.repeat.set(1,1);texture.offset.set(0,0);if(layout==='sbs'){texture.repeat.x=.5;texture.offset.x=eye*.5}else if(layout==='tb'){texture.repeat.y=.5;texture.offset.y=eye===0?.5:0}texture.updateMatrix()}
function applyPanoZoom(){camera.zoom=1;camera.fov=fovForZoom(70,panoZoomLevel);camera.updateProjectionMatrix()}
function applyProjection(){screen.visible=active&&projection==='flat';sphere.visible=active&&projection!=='flat';sphere180.visible=projection==='180';sphere360.visible=projection==='360';if(projection==='flat'){camera.zoom=1;camera.fov=70;camera.updateProjectionMatrix()}else applyPanoZoom();setEyeTexture(0);fitScreen()}
function fitScreen(){if(!video.videoWidth)return;const ratio=video.videoWidth/video.videoHeight;screen.scale.set(ratio/(16/9)*flatZoomLevel,flatZoomLevel,1)}
function toggle(){ video.paused?video.play().catch(()=>toast('Tap once to allow playback')):video.pause(); }
function seek(n){video.currentTime=Math.max(0,Math.min(video.duration||Infinity,video.currentTime+n));toast(`${n>0?'+':''}${n}s`)}
function volume(n){video.volume=Math.max(0,Math.min(1,video.volume+n));toast(`Volume ${Math.round(video.volume*100)}%`)}
function zoom(n){const factor=n>0?1.35:1/1.35;if(projection==='flat'){flatZoomLevel*=factor;screen.scale.multiplyScalar(factor);toast(`Zoom ${flatZoomLevel.toFixed(2)}×`)}else{panoZoomLevel*=factor;applyPanoZoom();toast(`VR zoom ${panoZoomLevel.toFixed(2)}×`)}}
function recenter(){bringVideoHere()}
function toast(t){const el=$('#toast');el.textContent=t;el.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>el.classList.remove('show'),1400)}
function placeInView(object,y=-.15,distance=2.25){object.position.set(0,y,-distance).applyQuaternion(camera.quaternion).add(camera.position);object.quaternion.copy(camera.quaternion)}
function bringVideoHere(){camera.updateMatrixWorld();contentDirection.copy(camera.quaternion);if(projection==='flat'){screen.position.set(0,0,-4).applyQuaternion(camera.quaternion).add(camera.position);screen.quaternion.copy(camera.quaternion)}else sphere.quaternion.copy(camera.quaternion);bringPrompt.visible=false;if(!menuCollapsed)showControls();toast('Video moved to current view')}
function showControls(){
  if(!cardboard)return;menuCollapsed=false;drawer.visible=false;controlsShown=true;controlsUntil=performance.now()+5000;ui.visible=true;reticle.visible=true;
  // Pin the panel in front of the current view, then leave it in world space so gaze can target it.
  ui.position.set(0,-1.05,-2.7).applyQuaternion(camera.quaternion).add(camera.position);ui.quaternion.copy(camera.quaternion);
}
function hideControls(){controlsShown=false;ui.visible=false;dwell.visible=false;hovered=null;hiddenView.copy(camera.quaternion)}
function collapseControls(){menuCollapsed=true;hideControls();placeInView(drawer,-.9,2.1);drawer.visible=true;drawer.material.opacity=.34;drawerUntil=Infinity;reticle.visible=true;toast('Controls hidden')}
function showDrawer(){if(!cardboard||!menuCollapsed)return;placeInView(drawer,.35,2.1);drawer.visible=true;drawer.material.opacity=.34;drawerUntil=performance.now()+10000;reticle.visible=true}
function expandControls(){menuCollapsed=false;drawer.visible=false;showControls()}
function activatePhysicalTarget(){
  if(!cardboard||performance.now()-lastPhysicalActivation<350)return false;
  camera.updateMatrixWorld(true);raycaster.setFromCamera(center,camera);
  const tapTargets=buttons.filter(o=>o.visible&&o.parent?.visible!==false);
  // Prefer the exact center-ray target. Some headset buttons touch the screen
  // before Android sends a usable pointer position, so fall back to the one
  // special action currently visible (the prompt has priority over the drawer).
  const highlightedTarget=hovered&&tapTargets.includes(hovered)?hovered:null;
  const intersection=raycaster.intersectObjects(tapTargets,false)[0];const target=intersection?.object||highlightedTarget||(bringPrompt.visible?bringPrompt:null)||(drawer.visible?drawer:null);
  if(intersection?.uv)target.userData.hitU=intersection.uv.x;
  if(!target)return false;lastPhysicalActivation=performance.now();target.userData.pulseAt=performance.now();target.userData.action();return true;
}

function updateFormatHint(){const hints={mono:projection==='flat'?'2D has no stereoscopic depth.':'Mono: the same panoramic view is sent to both eyes.',sbs:'SBS active: left half → left eye, right half → right eye.',tb:'Top/bottom active: one half is sent to each eye.'};$('#formatHint').textContent=hints[layout]}
$('.mode-grid').addEventListener('click',e=>{const b=e.target.closest('.mode');if(!b)return;document.querySelectorAll('.mode').forEach(x=>x.classList.toggle('active',x===b));projection=b.dataset.mode;if(projection==='flat'){layout='mono'}else{layout='sbs';toast(`${projection}° VR: 3D side-by-side selected`)}$('#layout').value=layout;updateFormatHint();applyProjection()});
$('#layout').addEventListener('change',e=>{layout=e.target.value;updateFormatHint();applyProjection()});
$('#distortion').addEventListener('input',e=>{warpMat.uniforms.k.value=+e.target.value;$('#distortionValue').value=(+e.target.value).toFixed(2)});
$('#ipd').addEventListener('input',e=>{stereoCamera.eyeSep=+e.target.value/1000;$('#ipdValue').value=`${e.target.value} mm`});
$('#frameDistance').addEventListener('input',e=>{const value=+e.target.value;warpMat.uniforms.frameDistance.value=value/100;$('#frameDistanceValue').value=value===0?'Center':`${Math.abs(value)} ${value<0?'close':'far'}`});
$('#file').addEventListener('click',e=>{e.target.value=''});
$('#file').addEventListener('change',async e=>{
  const f=e.target.files[0];if(!f)return;const thisLoad=++loadId, oldUrl=sourceUrl, newUrl=URL.createObjectURL(f);
  video.pause();video.removeAttribute('src');video.load();sourceUrl=newUrl;video.src=newUrl;texture.needsUpdate=true;
  $('#normal').disabled=$('#headset').disabled=false;$('#status').textContent=`Loading: ${f.name}`;video.load();
  try{await new Promise((resolve,reject)=>{const ok=()=>{cleanup();resolve()};const bad=()=>{cleanup();reject(video.error)};const cleanup=()=>{video.removeEventListener('loadedmetadata',ok);video.removeEventListener('error',bad)};video.addEventListener('loadedmetadata',ok);video.addEventListener('error',bad)});if(thisLoad!==loadId)return;video.currentTime=0;$('#status').textContent=`${video.videoWidth}×${video.videoHeight} • ${format(video.duration)}`;if(active)await video.play();}catch{toast('This browser cannot decode that video')}finally{if(oldUrl)URL.revokeObjectURL(oldUrl)}
});
video.addEventListener('loadedmetadata',()=>{$('#status').textContent=`${video.videoWidth}×${video.videoHeight} • ${format(video.duration)}`;fitScreen()});
video.addEventListener('error',()=>toast('This browser cannot decode that video format'));
function format(s){if(!isFinite(s))return 'live';return `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`}

async function start(headset){active=true;cardboard=headset;menuCollapsed=false;contentDirection.copy(camera.quaternion);reticleMotionAnchor.copy(camera.quaternion);reticleUntil=performance.now()+5000;renderer.setPixelRatio(headset?Math.min(devicePixelRatio,1.15):normalPixelRatio);renderer.setSize(innerWidth,innerHeight);$('#launcher').classList.add('hidden');$('#exit').classList.remove('hidden');applyProjection();await video.play().catch(()=>toast('Tap screen to play'));if(headset){await enableOrientation();showControls();tryFullscreen();screen.orientation?.lock?.('landscape').catch(()=>{});}}
$('#normal').onclick=()=>start(false);$('#headset').onclick=()=>start(true);$('#exit').onclick=stop;
function stop(){active=false;cardboard=false;renderer.setPixelRatio(normalPixelRatio);renderer.setSize(innerWidth,innerHeight);video.pause();drawer.visible=bringPrompt.visible=ui.visible=reticle.visible=reticleOutline.visible=dwell.visible=screen.visible=sphere.visible=false;$('#launcher').classList.remove('hidden');$('#exit').classList.add('hidden');if(document.fullscreenElement)document.exitFullscreen();}
async function tryFullscreen(){try{await document.documentElement.requestFullscreen({navigationUI:'hide'})}catch{}}
async function enableOrientation(){if(typeof DeviceOrientationEvent?.requestPermission==='function'){try{orientationEnabled=(await DeviceOrientationEvent.requestPermission())==='granted'}catch{}}else orientationEnabled=true;}
window.addEventListener('deviceorientation',e=>{if(!cardboard||renderer.xr.isPresenting||!orientationEnabled||e.alpha==null)return;const firstReading=baseHeading==null;if(firstReading)baseHeading=e.alpha;const rad=THREE.MathUtils.degToRad;const eu=new THREE.Euler(rad(e.beta||0),rad(e.alpha-baseHeading),-rad(e.gamma||0),'YXZ');const q1=new THREE.Quaternion(-Math.sqrt(.5),0,0,Math.sqrt(.5));const orient=rad(screen.orientation?.angle||window.orientation||0);camera.quaternion.setFromEuler(eu).multiply(q1).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),-orient));if(firstReading)contentDirection.copy(camera.quaternion)});
canvas.addEventListener('pointerdown',e=>{dragging=true;lastX=pointerStartX=e.clientX;lastY=pointerStartY=e.clientY;if(active&&!cardboard)toggle()});canvas.addEventListener('pointerenter',e=>{lastX=e.clientX;lastY=e.clientY});window.addEventListener('pointerup',e=>{const wasTap=Math.hypot((e.clientX??pointerStartX)-pointerStartX,(e.clientY??pointerStartY)-pointerStartY)<18;dragging=false;if(wasTap)activatePhysicalTarget()});window.addEventListener('pointermove',e=>{if(!dragging&&!cardboard){lastX=e.clientX;lastY=e.clientY;return}const dx=e.clientX-lastX,dy=e.clientY-lastY;if(Math.abs(dx)>innerWidth/2||Math.abs(dy)>innerHeight/2){lastX=e.clientX;lastY=e.clientY;return}yaw-=dx*.004;pitch=Math.max(-1.4,Math.min(1.4,pitch-dy*.004));camera.rotation.set(pitch,yaw,0,'YXZ');lastX=e.clientX;lastY=e.clientY});
// Capture on the whole document because a mechanical headset button can touch
// an overlay rather than the WebGL canvas, and many viewers emit press-down only.
for(const eventName of ['pointerdown','mousedown','touchstart','click'])document.addEventListener(eventName,e=>{if(!cardboard||e.target?.closest?.('#launcher'))return;if(activatePhysicalTarget()){e.preventDefault();e.stopPropagation()}},{capture:true,passive:false});
window.addEventListener('keydown',e=>{if(cardboard&&(e.key==='Enter'||e.key===' ')){e.preventDefault();activatePhysicalTarget()}});

function render(){const now=performance.now();if(active&&video.duration)updateTimeline(video.currentTime/video.duration);if(cardboard){
    if(camera.quaternion.angleTo(reticleMotionAnchor)>=THREE.MathUtils.degToRad(20)){reticleMotionAnchor.copy(camera.quaternion);reticleUntil=now+5000}
    const reticleFade=Math.min(1,Math.max(0,(reticleUntil-now)/1000));reticle.visible=!vrTestFreeze&&reticleFade>0;reticleOutline.visible=reticle.visible;reticle.material.opacity=.3*reticleFade;reticleOutline.material.opacity=.2*reticleFade;
    const turnFromVideo=camera.quaternion.angleTo(contentDirection);
    if(turnFromVideo>=THREE.MathUtils.degToRad(80)&&!bringPrompt.visible){placeInView(bringPrompt,0,1.9);bringPrompt.visible=true;reticle.visible=true}else if(turnFromVideo<THREE.MathUtils.degToRad(45))bringPrompt.visible=false;
    if(controlsShown&&now>=controlsUntil)hideControls();
    else if(menuCollapsed){drawerUntil=Infinity}
    else if(!controlsShown&&camera.quaternion.angleTo(hiddenView)>=THREE.MathUtils.degToRad(20))showControls();
    if(controlsShown&&!hovered&&camera.quaternion.angleTo(ui.quaternion)>=THREE.MathUtils.degToRad(35)){ui.position.set(0,-1.05,-2.7).applyQuaternion(camera.quaternion).add(camera.position);ui.quaternion.copy(camera.quaternion)}
    if(menuCollapsed&&!hovered&&camera.quaternion.angleTo(drawer.quaternion)>=THREE.MathUtils.degToRad(35))placeInView(drawer,-.9,2.1);
    if(controlsShown){const opacity=Math.min(1,Math.max(0,(controlsUntil-now)/500));ui.traverse(o=>{if(o.material){o.material.transparent=true;o.material.opacity=opacity}})}
    const targets=buttons.filter(o=>o.visible&&o.parent?.visible!==false);camera.updateMatrixWorld();raycaster.setFromCamera(center,camera);const intersection=raycaster.intersectObjects(targets,false)[0];const hit=intersection?.object||null;if(intersection?.uv)hit.userData.hitU=intersection.uv.x;if(hit!==hovered){hovered=hit;hoverAt=now;buttons.forEach(b=>b.userData.targetScale=b===hovered&&!b.userData.noAnimate?1.1:1);reticle.material.color.set(hovered?0xe2e5e9:0xffffff)}if(hovered){reticleUntil=Math.max(reticleUntil,now+1000);controlsUntil=Math.max(controlsUntil,now+(hovered===progressBg?5500:1000))}if(hovered===drawer)drawerUntil=Math.max(drawerUntil,now+1200);buttons.forEach(b=>{if(b.userData.noAnimate)return;const pulse=now-(b.userData.pulseAt||0)<180?1.13:(b.userData.targetScale||1);const scale=THREE.MathUtils.lerp(b.scale.x,pulse,.18);b.scale.setScalar(scale);b.material.color.lerp(b===hovered?buttonGlow:buttonWhite,.14)});const elapsed=hovered?now-hoverAt:0,dwellMs=hovered?(hovered.userData.dwellMs||900):900,dwellProgress=Math.min(1,elapsed/dwellMs);dwell.visible=!!hovered&&reticle.visible;dwell.material.opacity=Math.min(.3,dwellProgress);dwell.rotation.z=-elapsed*.003;dwell.scale.setScalar(.7+.5*dwellProgress);if(hovered&&elapsed>dwellMs){hovered.userData.action();controlsUntil=now+5000;hoverAt=now+650}
  }
  if(cardboard&&!renderer.xr.isPresenting){
    const w=canvas.width, h=canvas.height, eyeW=Math.ceil(w/2);if(leftTarget.width!==eyeW||leftTarget.height!==h){leftTarget.setSize(eyeW,h);rightTarget.setSize(eyeW,h)}camera.updateMatrixWorld();stereoCamera.aspect=.5;stereoCamera.update(camera);
    renderer.setScissorTest(false);renderer.setViewport(0,0,eyeW,h);renderer.setClearColor(0x000000);
    renderer.setRenderTarget(leftTarget);renderer.clear();setEyeTexture(0);renderer.render(scene,stereoCamera.cameraL);
    renderer.setRenderTarget(rightTarget);renderer.clear();setEyeTexture(1);renderer.render(scene,stereoCamera.cameraR);
    renderer.setRenderTarget(null);renderer.setViewport(0,0,w/renderer.getPixelRatio(),h/renderer.getPixelRatio());renderer.render(postScene,postCamera);
  }else renderer.render(scene,camera)}
renderer.setAnimationLoop(render);
window.addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight)});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&!renderer.xr.isPresenting)video.pause()});
window.addEventListener('beforeunload',()=>{if(sourceUrl)URL.revokeObjectURL(sourceUrl)});

if(new URLSearchParams(location.search).has('vrtest'))window.__vrTest={zoomIn:()=>zoom(1),zoomOut:()=>zoom(-1),freeze:()=>{vrTestFreeze=true;video.pause();ui.visible=false;drawer.visible=false;bringPrompt.visible=false;reticle.visible=false;reticleOutline.visible=false},getState:()=>({projection,layout,panoZoomLevel,fov:camera.fov})};

if(navigator.xr){const vr=VRButton.createButton(renderer,{optionalFeatures:['local-floor']});vr.style.display='none';document.body.appendChild(vr);}
