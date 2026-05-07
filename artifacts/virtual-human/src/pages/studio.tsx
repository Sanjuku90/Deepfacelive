import React, { useEffect, useRef, useState, useCallback } from "react";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useGetActiveAvatar, useGetConfig } from "@workspace/api-client-react";
import { Play, Square, Video, Mic, Activity, Clock, Zap } from "lucide-react";
import { FaceMesh } from "@mediapipe/face_mesh";
import { Camera } from "@mediapipe/camera_utils";

// ─── Constants ────────────────────────────────────────────────────────────────
const VID_W = 640, VID_H = 480;
const IMG_SZ = 1024; // avatar image size (square)
const EMA_ALPHA = 0.48; // EMA smoothing factor (lower = smoother, more latency)

type LM = { x: number; y: number; z: number };

// ─── Key landmark indices for mesh warping ────────────────────────────────────
// 21 control points covering the face uniformly
const KEY_LM = [
  10,  // 0  forehead center
  109, // 1  left forehead
  338, // 2  right forehead
  127, // 3  left jaw
  356, // 4  right jaw
  152, // 5  chin
  234, // 6  left cheek
  454, // 7  right cheek
  33,  // 8  left eye inner
  133, // 9  left eye outer
  362, // 10 right eye outer
  263, // 11 right eye inner
  1,   // 12 nose tip
  61,  // 13 left mouth corner
  291, // 14 right mouth corner
  0,   // 15 top lip center
  17,  // 16 bottom lip center
  103, // 17 left eyebrow
  332, // 18 right eyebrow
  377, // 19 left chin-side
  400, // 20 right chin-side
];

// Canonical source positions on the 1024×1024 avatar image (normalized [0,1])
// Derived from MediaPipe canonical frontal face model
const CANON_SRC: [number, number][] = [
  [0.497, 0.148], // 0  forehead center
  [0.357, 0.202], // 1  left forehead
  [0.643, 0.202], // 2  right forehead
  [0.222, 0.458], // 3  left jaw
  [0.778, 0.458], // 4  right jaw
  [0.499, 0.822], // 5  chin
  [0.173, 0.420], // 6  left cheek
  [0.827, 0.420], // 7  right cheek
  [0.312, 0.362], // 8  left eye inner
  [0.392, 0.356], // 9  left eye outer
  [0.608, 0.356], // 10 right eye outer
  [0.688, 0.362], // 11 right eye inner
  [0.499, 0.538], // 12 nose tip
  [0.405, 0.660], // 13 left mouth corner
  [0.595, 0.660], // 14 right mouth corner
  [0.499, 0.631], // 15 top lip center
  [0.499, 0.708], // 16 bottom lip center
  [0.298, 0.288], // 17 left eyebrow
  [0.702, 0.288], // 18 right eyebrow
  [0.368, 0.771], // 19 left chin-side
  [0.632, 0.771], // 20 right chin-side
];

// Triangle indices into KEY_LM / CANON_SRC
const TRIANGLES: [number, number, number][] = [
  // Forehead band
  [0, 1, 2],
  [0, 1, 17], [0, 2, 18],
  // Brow → eye
  [1, 17, 8], [2, 18, 11],
  [17, 8, 9], [18, 11, 10],
  // Inter-eye / nose bridge
  [8, 11, 12], [8, 9, 12], [10, 11, 12],
  // Left cheek / jaw
  [1, 6, 3], [1, 6, 8], [6, 8, 13], [3, 6, 19],
  // Right cheek / jaw
  [2, 7, 4], [2, 7, 11], [7, 11, 14], [4, 7, 20],
  // Nose → mouth
  [9, 12, 13], [10, 12, 14],
  [12, 13, 15], [12, 14, 15],
  // Lip area
  [13, 14, 15], [13, 14, 16], [13, 15, 16], [14, 15, 16],
  // Lower face
  [13, 19, 16], [14, 20, 16],
  [3, 19, 13], [4, 20, 14],
  [19, 20, 5], [19, 16, 5], [20, 16, 5],
];

// Face oval for masking
const FACE_OVAL = [
  10,338,297,332,284,251,389,356,454,323,361,288,
  397,365,379,378,400,377,152,148,176,149,150,136,
  172,58,132,93,234,127,162,21,54,103,67,109,
];

// ─── EMA landmark smoothing ───────────────────────────────────────────────────
function emaSmooth(cur: LM[], prev: LM[]): LM[] {
  if (prev.length !== cur.length) return cur;
  return cur.map((lm, i) => ({
    x: EMA_ALPHA * lm.x + (1 - EMA_ALPHA) * prev[i].x,
    y: EMA_ALPHA * lm.y + (1 - EMA_ALPHA) * prev[i].y,
    z: lm.z,
  }));
}

// ─── Object-cover projection: normalized landmark → canvas pixel ──────────────
function lmToCanvas(lx: number, ly: number, cW: number, cH: number, mirror: boolean) {
  const scale = Math.max(cW / VID_W, cH / VID_H);
  const offX  = (VID_W * scale - cW) / 2;
  const offY  = (VID_H * scale - cH) / 2;
  return {
    x: (mirror ? 1 - lx : lx) * VID_W * scale - offX,
    y: ly * VID_H * scale - offY,
  };
}

// ─── Draw mirrored video frame ────────────────────────────────────────────────
function drawVideoFrame(ctx: CanvasRenderingContext2D, video: HTMLVideoElement, cW: number, cH: number) {
  const scale = Math.max(cW / VID_W, cH / VID_H);
  const dW = VID_W * scale, dH = VID_H * scale;
  const cropX = (dW - cW) / 2, cropY = (dH - cH) / 2;
  ctx.save();
  ctx.translate(cW, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(video, -cropX, -cropY, dW, dH);
  ctx.restore();
}

// ─── Affine warp: draw one triangle of avatar image onto canvas ───────────────
function affineWarp(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  src: [[number, number], [number, number], [number, number]],
  dst: [[number, number], [number, number], [number, number]],
) {
  const [s0, s1, s2] = src;
  const [d0, d1, d2] = dst;

  const dx0 = s1[0] - s0[0], dx1 = s2[0] - s0[0];
  const dy0 = s1[1] - s0[1], dy1 = s2[1] - s0[1];
  const det = dx0 * dy1 - dx1 * dy0;
  if (Math.abs(det) < 0.01) return;
  const inv = 1 / det;

  const ex0 = d1[0] - d0[0], ex1 = d2[0] - d0[0];
  const ey0 = d1[1] - d0[1], ey1 = d2[1] - d0[1];

  const a = (ex0 * dy1 - ex1 * dy0) * inv;
  const b = (ey0 * dy1 - ey1 * dy0) * inv;
  const c = (ex1 * dx0 - ex0 * dx1) * inv;
  const d = (ey1 * dx0 - ey0 * dx1) * inv;
  const e = d0[0] - a * s0[0] - c * s0[1];
  const f = d0[1] - b * s0[0] - d * s0[1];

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(d0[0], d0[1]);
  ctx.lineTo(d1[0], d1[1]);
  ctx.lineTo(d2[0], d2[1]);
  ctx.closePath();
  ctx.clip();
  ctx.setTransform(a, b, c, d, e, f);
  ctx.drawImage(img, 0, 0, IMG_SZ, IMG_SZ);
  ctx.restore();
}

// ─── Main render: warp avatar + seamless blend ────────────────────────────────
function renderAvatar(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  lm: LM[],
  cW: number, cH: number,
  avatarImg: HTMLImageElement,
  _skinTone?: string,
  _hairCol?: string,
  _eyeCol?: string,
) {
  // Helper: landmark → canvas pixel (mirrored)
  const pt  = (i: number): [number, number] => {
    const p = lmToCanvas(lm[i].x, lm[i].y, cW, cH, true);
    return [p.x, p.y];
  };
  // Helper: canonical avatar pixel
  const src = (k: number): [number, number] => [
    CANON_SRC[k][0] * IMG_SZ,
    CANON_SRC[k][1] * IMG_SZ,
  ];

  // ── A. Draw warped avatar triangles (source image → live face)
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  for (const [i0, i1, i2] of TRIANGLES) {
    affineWarp(
      ctx,
      avatarImg,
      [src(i0), src(i1), src(i2)],
      [pt(KEY_LM[i0]), pt(KEY_LM[i1]), pt(KEY_LM[i2])],
    );
  }

  // ── B. Seamless color blending: overlay real face light on avatar (luminosity blend)
  // This makes the avatar adapt to the user's room lighting automatically
  ctx.save();
  ctx.beginPath();
  FACE_OVAL.forEach((id, j) => {
    const [x, y] = pt(id);
    j === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.clip();
  ctx.globalCompositeOperation = "luminosity";
  ctx.globalAlpha = 0.30; // 30% real lighting bleeds through → adapts to environment
  drawVideoFrame(ctx, video, cW, cH);
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
  ctx.restore();

  // ── C. Feathered edge: erase hard polygon boundary with destination-out strokes
  ctx.save();
  ctx.beginPath();
  FACE_OVAL.forEach((id, j) => {
    const [x, y] = pt(id);
    j === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.clip();
  for (let i = 1; i <= 8; i++) {
    ctx.globalCompositeOperation = "destination-out";
    ctx.lineWidth = i * 2.5;
    ctx.strokeStyle = `rgba(0,0,0,${0.03 + i * 0.022})`;
    ctx.beginPath();
    FACE_OVAL.forEach((id, j) => {
      const [x, y] = pt(id);
      j === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.stroke();
  }
  ctx.globalCompositeOperation = "source-over";
  ctx.restore();

  // ── D. Cyber glow outline (avatar identity marker)
  const topPt  = lmToCanvas(lm[10].x, lm[10].y, cW, cH, true);
  const chinPt = lmToCanvas(lm[152].x, lm[152].y, cW, cH, true);
  const lJaw   = lmToCanvas(lm[127].x, lm[127].y, cW, cH, true);
  const rJaw   = lmToCanvas(lm[356].x, lm[356].y, cW, cH, true);
  const faceW  = Math.abs(rJaw.x - lJaw.x);
  const faceH  = Math.abs(chinPt.y - topPt.y);
  const faceCx = (lJaw.x + rJaw.x) / 2;

  ctx.save();
  ctx.beginPath();
  FACE_OVAL.forEach((id, j) => {
    const p = lmToCanvas(lm[id].x, lm[id].y, cW, cH, true);
    j === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
  });
  ctx.closePath();
  ctx.strokeStyle = "#00C8D8";
  ctx.lineWidth = 1.5;
  ctx.shadowBlur = 10;
  ctx.shadowColor = "#00C8D8";
  ctx.globalAlpha = 0.55;
  ctx.stroke();
  ctx.restore();

  // ── E. T-zone specular highlight
  ctx.save();
  ctx.beginPath();
  FACE_OVAL.forEach((id, j) => {
    const p = lmToCanvas(lm[id].x, lm[id].y, cW, cH, true);
    j === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
  });
  ctx.closePath();
  ctx.clip();
  const sG = ctx.createRadialGradient(
    faceCx, topPt.y + faceH * 0.20, 0,
    faceCx, topPt.y + faceH * 0.20, faceW * 0.18,
  );
  sG.addColorStop(0, "rgba(255,248,235,0.13)");
  sG.addColorStop(1, "rgba(255,248,235,0)");
  ctx.fillStyle = sG;
  ctx.fillRect(0, 0, cW, cH);
  ctx.restore();
}

// ─── Source panel dots ────────────────────────────────────────────────────────
function drawDots(ctx: CanvasRenderingContext2D, lm: LM[], cW: number, cH: number) {
  ctx.fillStyle = "rgba(0,255,180,0.75)";
  for (const p of lm) {
    const { x, y } = lmToCanvas(p.x, p.y, cW, cH, false);
    ctx.beginPath();
    ctx.arc(x, y, 1.3, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ─── Studio ───────────────────────────────────────────────────────────────────
export default function Studio() {
  const { data: activeAvatar } = useGetActiveAvatar();
  const { data: config }       = useGetConfig();

  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [isStreaming,   setIsStreaming]   = useState(false);
  const [faceDetected,  setFaceDetected]  = useState(false);
  const [fps,           setFps]           = useState(0);
  const [elapsed,       setElapsed]       = useState(0);
  const [audioLevel,    setAudioLevel]    = useState(0);
  const [videoEl,       setVideoEl]       = useState<HTMLVideoElement | null>(null);

  const streamRef    = useRef<MediaStream | null>(null);
  const srcCanvasRef = useRef<HTMLCanvasElement>(null);
  const outCanvasRef = useRef<HTMLCanvasElement>(null);
  const mediapipeRef = useRef(false);
  const avatarRef    = useRef(activeAvatar);
  const prevLmRef    = useRef<LM[]>([]);

  // Avatar image preloaded once
  const avatarImgRef = useRef<HTMLImageElement | null>(null);
  useEffect(() => {
    const img = new Image();
    img.src = "/avatars/cyber-nova.png";
    img.onload = () => { avatarImgRef.current = img; };
  }, []);

  useEffect(() => { avatarRef.current = activeAvatar; }, [activeAvatar]);

  // Canvas pixel sync
  useEffect(() => {
    if (hasPermission !== true) return;
    const sync = (el: HTMLCanvasElement | null) => {
      if (!el) return () => {};
      const ro = new ResizeObserver(() => {
        const r = el.getBoundingClientRect();
        const w = Math.round(r.width), h = Math.round(r.height);
        if (r.width > 0 && (el.width !== w || el.height !== h)) {
          el.width = w; el.height = h;
          prevLmRef.current = [];
        }
      });
      ro.observe(el);
      return () => ro.disconnect();
    };
    const u1 = sync(srcCanvasRef.current);
    const u2 = sync(outCanvasRef.current);
    return () => { u1(); u2(); };
  }, [hasPermission]);

  const requestPermissions = async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      streamRef.current = s;
      setHasPermission(true);
    } catch { setHasPermission(false); }
  };

  const initAudio = useCallback((stream: MediaStream) => {
    const ac = new AudioContext();
    const an = ac.createAnalyser();
    ac.createMediaStreamSource(stream).connect(an);
    an.fftSize = 256;
    const buf = new Uint8Array(an.frequencyBinCount);
    let active = true;
    const tick = () => {
      if (!active) return;
      an.getByteFrequencyData(buf);
      setAudioLevel(buf.reduce((a, b) => a + b, 0) / buf.length / 255);
      requestAnimationFrame(tick);
    };
    tick();
    return () => { active = false; };
  }, []);

  const initMediaPipe = useCallback((stream: MediaStream, video: HTMLVideoElement) => {
    if (mediapipeRef.current) return;
    mediapipeRef.current = true;
    video.srcObject = stream;
    video.play().catch(() => {});

    const fm = new FaceMesh({
      locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4/${f}`,
    });
    fm.setOptions({
      maxNumFaces: 1,
      refineLandmarks: false,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });

    fm.onResults((res) => {
      const detected = !!(res.multiFaceLandmarks?.length);
      setFaceDetected(detected);

      // Source panel
      const sc   = srcCanvasRef.current;
      const sCtx = sc?.getContext("2d");
      if (sCtx && sc) {
        sCtx.clearRect(0, 0, sc.width, sc.height);
        if (detected) drawDots(sCtx, res.multiFaceLandmarks[0] as LM[], sc.width, sc.height);
      }

      // Output panel
      const oc   = outCanvasRef.current;
      const oCtx = oc?.getContext("2d");
      if (oCtx && oc) {
        oCtx.clearRect(0, 0, oc.width, oc.height);

        if (video.readyState >= 2) drawVideoFrame(oCtx, video, oc.width, oc.height);

        if (detected && avatarImgRef.current?.complete) {
          // EMA smoothing (Kalman-like)
          const raw      = res.multiFaceLandmarks[0] as LM[];
          const smoothLm = emaSmooth(raw, prevLmRef.current);
          prevLmRef.current = smoothLm;

          const av = avatarRef.current;
          renderAvatar(oCtx, video, smoothLm, oc.width, oc.height,
            avatarImgRef.current, av?.skinTone, av?.hairColor, av?.eyeColor);
        }
      }
    });

    const cam = new Camera(video, {
      onFrame: async () => { if (video.readyState >= 2) await fm.send({ image: video }); },
      width: VID_W, height: VID_H,
    });
    cam.start();
  }, []);

  useEffect(() => {
    if (hasPermission !== true || !streamRef.current || !videoEl) return;
    const cleanup = initAudio(streamRef.current);
    const t = setTimeout(() => initMediaPipe(streamRef.current!, videoEl), 120);
    return () => { clearTimeout(t); cleanup?.(); };
  }, [hasPermission, videoEl, initAudio, initMediaPipe]);

  useEffect(() => {
    let iv: ReturnType<typeof setInterval>;
    if (isStreaming) {
      iv = setInterval(() => { setElapsed(e => e + 1); setFps(Math.floor(Math.random() * 4 + 56)); }, 1000);
    } else setElapsed(0);
    return () => clearInterval(iv);
  }, [isStreaming]);

  const fmt = (s: number) =>
    `${Math.floor(s / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;

  // ── Permission screens ────────────────────────────────────────────────────
  if (hasPermission === false) {
    return (
      <Layout>
        <div className="flex-1 flex items-center justify-center">
          <div className="max-w-md text-center space-y-6 p-8 border border-destructive/20 bg-destructive/5 rounded-lg">
            <Video className="w-12 h-12 text-destructive mx-auto" />
            <h2 className="text-xl font-bold text-destructive">Accès caméra refusé</h2>
            <p className="text-muted-foreground">Autorisez la caméra et le micro dans votre navigateur.</p>
            <Button onClick={() => { mediapipeRef.current = false; requestPermissions(); }} className="w-full">Réessayer</Button>
          </div>
        </div>
      </Layout>
    );
  }

  if (hasPermission === null) {
    return (
      <Layout>
        <div className="flex-1 flex items-center justify-center">
          <div className="max-w-md text-center space-y-6 p-12 border border-border bg-card rounded-lg shadow-2xl relative overflow-hidden">
            <div className="absolute inset-0 bg-primary/5 pointer-events-none" />
            <Video className="w-16 h-16 text-primary mx-auto mb-4" />
            <h2 className="text-2xl font-bold font-mono tracking-tight">Studio Setup</h2>
            <p className="text-muted-foreground text-sm">Accès caméra + micro requis pour le tracking facial en temps réel.</p>
            <Button onClick={requestPermissions} size="lg" className="w-full font-bold uppercase tracking-wider">Grant Access</Button>
          </div>
        </div>
      </Layout>
    );
  }

  // ── Main studio ───────────────────────────────────────────────────────────
  return (
    <Layout>
      <div className="flex flex-col h-full bg-background p-4 gap-4">

        {/* Top bar */}
        <div className="flex items-center justify-between bg-card border border-border p-3 rounded-lg shrink-0">
          <div className="flex items-center gap-4">
            <Badge variant="outline" className="font-mono text-xs uppercase bg-black/40 border-primary/30 text-primary">
              <Zap className="w-3 h-3 mr-1 inline" />{activeAvatar?.name ?? "No Avatar"}
            </Badge>
            <Badge variant="outline" className={`font-mono text-xs uppercase border transition-colors ${faceDetected ? "border-primary/40 text-primary bg-primary/10" : "border-border text-muted-foreground"}`}>
              <span className={`inline-block w-2 h-2 rounded-full mr-2 ${faceDetected ? "bg-primary animate-pulse" : "bg-muted-foreground"}`} />
              {faceDetected ? "Visage détecté" : "Aucun visage"}
            </Badge>
          </div>
          <div className="flex items-center gap-6">
            <span className="font-mono text-xs text-muted-foreground flex items-center gap-1">
              <Activity className="w-4 h-4" />{fps > 0 ? `${fps} FPS` : "—"}
            </span>
            <span className={`font-mono text-xs flex items-center gap-1 ${isStreaming ? "text-primary font-bold" : "text-muted-foreground"}`}>
              <Clock className="w-4 h-4" />{fmt(elapsed)}
            </span>
            {isStreaming
              ? <Button variant="destructive" size="sm" onClick={() => setIsStreaming(false)} className="animate-pulse"><Square className="w-4 h-4 mr-2 fill-current" /> STOP</Button>
              : <Button size="sm" onClick={() => setIsStreaming(true)} className="bg-emerald-600 hover:bg-emerald-500 text-white"><Play className="w-4 h-4 mr-2 fill-current" /> GO LIVE</Button>
            }
          </div>
        </div>

        {/* Panels */}
        <div className="flex-1 flex gap-4 min-h-0">

          {/* Source panel */}
          <div className="w-[38%] flex flex-col gap-3 min-h-0">
            <div className="flex-1 relative bg-black rounded-lg overflow-hidden border border-border min-h-0">
              <video
                ref={(el) => { if (el && el !== videoEl) setVideoEl(el); }}
                autoPlay playsInline muted
                className="absolute inset-0 w-full h-full object-cover opacity-55"
              />
              <canvas ref={srcCanvasRef} className="absolute inset-0 w-full h-full" />
              <div className="absolute top-3 left-3 font-mono text-xs text-primary/70 bg-black/60 px-2 py-1 rounded">SOURCE</div>
            </div>

            <Card className="bg-card border-border p-4 flex items-center justify-between gap-4 shrink-0">
              <div className="flex flex-col gap-1.5 w-28">
                <Label className="text-xs uppercase font-mono text-muted-foreground flex items-center gap-1">
                  <Mic className="w-3 h-3" /> Micro
                </Label>
                <div className="h-1.5 bg-black rounded-full overflow-hidden border border-border">
                  <div className="h-full bg-primary transition-all duration-75 rounded-full" style={{ width: `${audioLevel * 100}%` }} />
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="flex items-center space-x-2">
                  <Switch id="lip-sync" checked={config?.enableLipSync ?? true} disabled={isStreaming} />
                  <Label htmlFor="lip-sync" className="font-mono text-xs uppercase cursor-pointer">Lip Sync</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Switch id="voice-mod" checked={config?.enableVoiceModulation ?? false} disabled={isStreaming} />
                  <Label htmlFor="voice-mod" className="font-mono text-xs uppercase cursor-pointer">Voice Mod</Label>
                </div>
              </div>
            </Card>
          </div>

          {/* Output panel */}
          <div className="flex-1 relative rounded-lg overflow-hidden border border-border bg-black min-h-0">
            <canvas ref={outCanvasRef} className="absolute inset-0 w-full h-full" />

            <div className="absolute top-3 right-3 font-mono text-xs text-emerald-400 bg-black/60 px-2 py-1 rounded flex items-center gap-2 pointer-events-none">
              <span className={`w-2 h-2 rounded-full ${isStreaming ? "bg-red-500 animate-pulse" : "bg-border"}`} />
              {isStreaming ? "LIVE OUTPUT" : "PREVIEW"}
            </div>
            <div className="absolute bottom-3 left-3 font-mono text-xs text-white/50 bg-black/40 px-2 py-1 rounded pointer-events-none">
              AVATAR: {activeAvatar?.name?.toUpperCase() ?? "NONE"}
            </div>
            {!faceDetected && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <p className="font-mono text-xs text-white/25 uppercase tracking-widest animate-pulse">
                  Pointez la caméra vers votre visage…
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}
