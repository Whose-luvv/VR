import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
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
let controlsUntil = 0, hiddenView = new THREE.Quaternion(), controlsShown = false;

const panoMat = new THREE.ShaderMaterial({
  side: THREE.BackSide,
  uniforms: { map:{value:texture}, projection:{value:2}, layout:{value:0}, eye:{value:0} },
  vertexShader: `varying vec3 vDir; void main(){ vDir=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
  fragmentShader: `uniform sampler2D map; uniform int projection; uniform int layout; uniform float eye; varying vec3 vDir;
    void main(){ vec3 d=normalize(vDir); float lon=atan(d.x,-d.z); float lat=asin(clamp(d.y,-1.,1.));
      float u; if(projection==1){ if(abs(lon)>1.570796){gl_FragColor=vec4(0.,0.,0.,1.);return;} u=lon/3.14159265+.5; } else { u=lon/6.2831853+.5; }
      vec2 uv=vec2(fract(u),lat/3.14159265+.5); if(layout==1) uv.x=uv.x*.5+eye*.5; if(layout==2) uv.y=uv.y*.5+(1.-eye)*.5;
      gl_FragColor=texture2D(map,uv); }`
});
// 48×28 is visually smooth inside a phone headset while avoiding unnecessary
// per-eye geometry work on lower-end mobile GPUs.
const sphere = new THREE.Mesh(new THREE.SphereGeometry(10, 48, 28), panoMat);
sphere.visible = false; scene.add(sphere);
const flatMat = new THREE.MeshBasicMaterial({ map:texture, side:THREE.DoubleSide, toneMapped:false });
const screen = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 2.925), flatMat);
screen.position.set(0,1.6,-4); screen.visible=false; scene.add(screen);

// The menu lives in the world. If it were attached to the camera, head movement
// could never move the center ray onto a button.
const ui = new THREE.Group(); scene.add(ui); ui.position.set(0,.55,-2.7); ui.visible=false;
const buttons=[];
function makeLabel(text, action, x, width=.62){
  const c=document.createElement('canvas'); c.width=384; c.height=128; const g=c.getContext('2d');
  g.fillStyle='#101827dd';g.roundRect(4,4,376,120,24);g.fill();g.strokeStyle='#66f0c6';g.lineWidth=4;g.stroke();g.fillStyle='white';g.font='700 38px system-ui';g.textAlign='center';g.textBaseline='middle';g.fillText(text,192,64);
  const m=new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(c),transparent:true,depthTest:false});const mesh=new THREE.Mesh(new THREE.PlaneGeometry(width,.28),m);mesh.position.x=x;mesh.userData.action=action;ui.add(mesh);buttons.push(mesh);return mesh;
}
makeLabel('−10s',()=>seek(-10),-1.36); makeLabel('Play / Pause',toggle,-.52,.92); makeLabel('+10s',()=>seek(10),.38); makeLabel('Vol −',()=>volume(-.1),1.08); makeLabel('Vol +',()=>volume(.1),1.78);
makeLabel('Zoom −',()=>zoom(-.35),-.8);buttons.at(-1).position.y=-.36;makeLabel('Zoom +',()=>zoom(.35),0);buttons.at(-1).position.y=-.36;makeLabel('Recenter',recenter,.8,.78);buttons.at(-1).position.y=-.36;
const progressBg=new THREE.Mesh(new THREE.PlaneGeometry(3.75,.08),new THREE.MeshBasicMaterial({color:0x283449,depthTest:false}));progressBg.position.set(.2,.28,0);ui.add(progressBg);
const progress=new THREE.Mesh(new THREE.PlaneGeometry(3.75,.08),new THREE.MeshBasicMaterial({color:0x45e0b0,depthTest:false}));progress.position.set(-1.675,.28,.002);progress.scale.x=0;ui.add(progress);
const raycaster=new THREE.Raycaster(), center=new THREE.Vector2(0,0);let hovered=null, hoverAt=0;
const stereoCamera = new THREE.StereoCamera(); stereoCamera.eyeSep = .064;
const reticle=new THREE.Mesh(new THREE.CircleGeometry(.0035,16),new THREE.MeshBasicMaterial({color:0xffffff,depthTest:false,depthWrite:false}));reticle.position.set(0,0,-1);camera.add(reticle);reticle.visible=false;
const dwell=new THREE.Mesh(new THREE.RingGeometry(.026,.031,32),new THREE.MeshBasicMaterial({color:0x45e0b0,transparent:true,opacity:0,depthTest:false}));dwell.position.set(0,0,-.999);camera.add(dwell);

// Cardboard-style lens correction. Both eyes are rendered first, then warped
// around each physical lens centre to counter the headset's pincushion optics.
const leftTarget=new THREE.WebGLRenderTarget(2,2,{minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter,depthBuffer:true});
const rightTarget=new THREE.WebGLRenderTarget(2,2,{minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter,depthBuffer:true});
const postScene=new THREE.Scene(), postCamera=new THREE.OrthographicCamera(-1,1,1,-1,0,1);
const warpMat=new THREE.ShaderMaterial({depthTest:false,uniforms:{leftMap:{value:leftTarget.texture},rightMap:{value:rightTarget.texture},k:{value:.28},frameDistance:{value:0}},vertexShader:`varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position,1.);}`,fragmentShader:`uniform sampler2D leftMap;uniform sampler2D rightMap;uniform float k;uniform float frameDistance;varying vec2 vUv;void main(){bool rightEye=vUv.x>=.5;float localX=rightEye?(vUv.x-.5)*2.:vUv.x*2.;localX+=rightEye?-frameDistance:frameDistance;vec2 p=vec2(localX*2.-1.,vUv.y*2.-1.);float r2=dot(p,p);vec2 q=p*(1.+k*r2);if(max(abs(q.x),abs(q.y))>1.){gl_FragColor=vec4(0.,0.,0.,1.);return;}vec2 uv=(q+1.)*.5;gl_FragColor=rightEye?texture2D(rightMap,uv):texture2D(leftMap,uv);}`});
postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2),warpMat));

function applyProjection(){ screen.visible=active&&projection==='flat'; sphere.visible=active&&projection!=='flat'; panoMat.uniforms.projection.value=projection==='180'?1:2; panoMat.uniforms.layout.value={mono:0,sbs:1,tb:2}[layout]; fitScreen(); }
function fitScreen(){ if(!video.videoWidth)return; const ratio=video.videoWidth/video.videoHeight; screen.scale.set(ratio/(16/9),1,1); }
function toggle(){ video.paused?video.play().catch(()=>toast('Tap once to allow playback')):video.pause(); }
function seek(n){video.currentTime=Math.max(0,Math.min(video.duration||Infinity,video.currentTime+n));toast(`${n>0?'+':''}${n}s`)}
function volume(n){video.volume=Math.max(0,Math.min(1,video.volume+n));toast(`Volume ${Math.round(video.volume*100)}%`)}
function zoom(n){if(projection==='flat'){screen.position.z=Math.max(-7,Math.min(-2,screen.position.z+n));}else{camera.fov=Math.max(40,Math.min(100,camera.fov-n*20));camera.updateProjectionMatrix();}toast('Zoom adjusted')}
function recenter(){baseHeading=null;yaw=pitch=0;camera.quaternion.identity();camera.updateMatrixWorld();showControls();toast('View and controls recentered')}
function toast(t){const el=$('#toast');el.textContent=t;el.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>el.classList.remove('show'),1400)}
function showControls(){
  if(!cardboard)return;controlsShown=true;controlsUntil=performance.now()+5000;ui.visible=true;reticle.visible=true;
  // Pin the panel in front of the current view, then leave it in world space so gaze can target it.
  ui.position.set(0,-1.05,-2.7).applyQuaternion(camera.quaternion).add(camera.position);ui.quaternion.copy(camera.quaternion);
}
function hideControls(){controlsShown=false;ui.visible=false;dwell.visible=false;hovered=null;hiddenView.copy(camera.quaternion)}

$('.mode-grid').addEventListener('click',e=>{const b=e.target.closest('.mode');if(!b)return;document.querySelectorAll('.mode').forEach(x=>x.classList.toggle('active',x===b));projection=b.dataset.mode;applyProjection()});
$('#layout').addEventListener('change',e=>{layout=e.target.value;applyProjection()});
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

async function start(headset){active=true;cardboard=headset;renderer.setPixelRatio(headset?Math.min(devicePixelRatio,1.15):normalPixelRatio);renderer.setSize(innerWidth,innerHeight);$('#launcher').classList.add('hidden');$('#exit').classList.remove('hidden');applyProjection();await video.play().catch(()=>toast('Tap screen to play'));if(headset){await enableOrientation();showControls();tryFullscreen();screen.orientation?.lock?.('landscape').catch(()=>{});}}
$('#normal').onclick=()=>start(false);$('#headset').onclick=()=>start(true);$('#exit').onclick=stop;
function stop(){active=false;cardboard=false;renderer.setPixelRatio(normalPixelRatio);renderer.setSize(innerWidth,innerHeight);video.pause();ui.visible=reticle.visible=dwell.visible=screen.visible=sphere.visible=false;$('#launcher').classList.remove('hidden');$('#exit').classList.add('hidden');if(document.fullscreenElement)document.exitFullscreen();}
async function tryFullscreen(){try{await document.documentElement.requestFullscreen({navigationUI:'hide'})}catch{}}
async function enableOrientation(){if(typeof DeviceOrientationEvent?.requestPermission==='function'){try{orientationEnabled=(await DeviceOrientationEvent.requestPermission())==='granted'}catch{}}else orientationEnabled=true;}
window.addEventListener('deviceorientation',e=>{if(!cardboard||renderer.xr.isPresenting||!orientationEnabled||e.alpha==null)return;if(baseHeading==null)baseHeading=e.alpha;const rad=THREE.MathUtils.degToRad;const eu=new THREE.Euler(rad(e.beta||0),rad(e.alpha-baseHeading),-rad(e.gamma||0),'YXZ');const q1=new THREE.Quaternion(-Math.sqrt(.5),0,0,Math.sqrt(.5));const orient=rad(screen.orientation?.angle||window.orientation||0);camera.quaternion.setFromEuler(eu).multiply(q1).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),-orient));});
canvas.addEventListener('pointerdown',e=>{dragging=true;lastX=e.clientX;lastY=e.clientY;if(active&&!cardboard)toggle()});canvas.addEventListener('pointerenter',e=>{lastX=e.clientX;lastY=e.clientY});window.addEventListener('pointerup',()=>dragging=false);window.addEventListener('pointermove',e=>{if(!dragging&&!cardboard){lastX=e.clientX;lastY=e.clientY;return}const dx=e.clientX-lastX,dy=e.clientY-lastY;if(Math.abs(dx)>innerWidth/2||Math.abs(dy)>innerHeight/2){lastX=e.clientX;lastY=e.clientY;return}yaw-=dx*.004;pitch=Math.max(-1.4,Math.min(1.4,pitch-dy*.004));camera.rotation.set(pitch,yaw,0,'YXZ');lastX=e.clientX;lastY=e.clientY});

function render(){const now=performance.now();if(active&&video.duration)progress.scale.x=Math.max(.001,video.currentTime/video.duration);if(cardboard){
    if(controlsShown&&now>=controlsUntil)hideControls();else if(!controlsShown&&camera.quaternion.angleTo(hiddenView)>=THREE.MathUtils.degToRad(20))showControls();
    if(controlsShown){const opacity=Math.min(1,Math.max(0,(controlsUntil-now)/500));ui.traverse(o=>{if(o.material){o.material.transparent=true;o.material.opacity=opacity}});camera.updateMatrixWorld();raycaster.setFromCamera(center,camera);const hit=raycaster.intersectObjects(buttons,false)[0]?.object||null;if(hit!==hovered){hovered=hit;hoverAt=now;buttons.forEach(b=>b.scale.setScalar(b===hovered?1.08:1));}const elapsed=hovered?now-hoverAt:0;dwell.visible=!!hovered;dwell.material.opacity=Math.min(1,elapsed/900);dwell.scale.setScalar(.7+.35*Math.min(1,elapsed/900));if(hovered&&elapsed>900){hovered.userData.action();controlsUntil=now+5000;hoverAt=now+650;}}
  }
  if(cardboard&&!renderer.xr.isPresenting){
    const w=canvas.width, h=canvas.height, eyeW=Math.ceil(w/2);if(leftTarget.width!==eyeW||leftTarget.height!==h){leftTarget.setSize(eyeW,h);rightTarget.setSize(eyeW,h)}camera.updateMatrixWorld();stereoCamera.aspect=.5;stereoCamera.update(camera);
    renderer.setScissorTest(false);renderer.setViewport(0,0,eyeW,h);renderer.setClearColor(0x000000);
    renderer.setRenderTarget(leftTarget);renderer.clear();panoMat.uniforms.eye.value=0;renderer.render(scene,stereoCamera.cameraL);
    renderer.setRenderTarget(rightTarget);renderer.clear();panoMat.uniforms.eye.value=1;renderer.render(scene,stereoCamera.cameraR);
    renderer.setRenderTarget(null);renderer.setViewport(0,0,w/renderer.getPixelRatio(),h/renderer.getPixelRatio());renderer.render(postScene,postCamera);
  }else renderer.render(scene,camera)}
renderer.setAnimationLoop(render);
window.addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight)});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&!renderer.xr.isPresenting)video.pause()});
window.addEventListener('beforeunload',()=>{if(sourceUrl)URL.revokeObjectURL(sourceUrl)});

if(navigator.xr){const vr=VRButton.createButton(renderer,{optionalFeatures:['local-floor']});vr.style.display='none';document.body.appendChild(vr);}
