# Jio VR Player

A privacy-friendly local video player for phone-based VR headsets. It supports flat 2D, 180° and 360° equirectangular video, with mono, side-by-side and top/bottom source layouts.

## Run

```bash
npm install
npm run dev
```

Open the shown network URL on the phone while both devices are on the same Wi-Fi. For production, deploy `npm run build` output over HTTPS (motion/VR and fullscreen APIs work best in a secure context).

Inside headset mode, look at a control for about one second to activate it. Drag on screen to look around in normal player mode.

## Free Render deployment

1. In Render, choose **New → Blueprint** and connect this repository.
2. Render detects `render.yaml`; approve the `jio-vr-player` static service.
3. Open the generated HTTPS URL on the phone. HTTPS is required by mobile browsers for reliable gyroscope access.

Video files are selected and decoded locally on the phone. They are not uploaded to Render, so hosting bandwidth does not affect playback after a file is selected.
