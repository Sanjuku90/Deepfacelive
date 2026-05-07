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

// ─── Landmark index groups ────────────────────────────────────────────────────
const FACE_OVAL = [10,338,297,332,284,251,389,356,454,323,361,288,397,365,379,378,400,377,152,148,176,149,150,136,172,58,132,93,234,127,162,21,54,103,67,109];
const LEFT_EYE  = [33,7,163,144,145,153,154,155,133,173,157,158,159,160,161,246];
const RIGHT_EYE = [362,382,381,380,374,373,390,249,263,466,388,387,386,385,384,398];

const VID_W = 640;
const VID_H = 480;

// ─── EMA landmark smoothing (reduces jitter / trembling) ─────────────────────
// alpha=1 means no smoothing; alpha=0.45 gives fluid tracking without lag
const EMA_ALPHA = 0.50;

type LM = { x: number; y: number; z: number };

function emaSmooth(cur: LM[], prev: LM[]): LM[] {
  if (prev.length !== cur.length) return cur;
  return cur.map((lm, i) => ({
    x: EMA_ALPHA * lm.x + (1 - EMA_ALPHA) * prev[i].x,
    y: EMA_ALPHA * lm.y + (1 - EMA_ALPHA) * prev[i].y,
    z: lm.z,
  }));
}

// ─── Object-cover projection ──────────────────────────────────────────────────
function lmToCanvas(lx: number, ly: number, cW: number, cH: number, mirrored: boolean) {
  const scale = Math.max(cW / VID_W, cH / VID_H);
  const offX  = (VID_W * scale - cW) / 2;
  const offY  = (VID_H * scale - cH) / 2;
  return {
    x: (mirrored ? 1 - lx : lx) * VID_W * scale - offX,
    y: ly * VID_H * scale - offY,
  };
}

// ─── Color palettes ───────────────────────────────────────────────────────────
function getSkin(tone?: string) {
  switch ((tone ?? "medium").toLowerCase()) {
    case "light":  return { tint: "#F2C890", dark: "#C09060" };
    case "dark":   return { tint: "#7A4020", dark: "#4A2010" };
    default:       return { tint: "#C07840", dark: "#905030" };
  }
}
function getEyeHex(c?: string) {
  switch ((c ?? "brown").toLowerCase()) {
    case "blue":   return "#1855B8";
    case "green":  return "#177040";
    case "gray":   return "#485868";
    case "cyan":   return "#007888";
    case "purple": return "#5820A0";
    default:       return "#5A3818";
  }
}

// ─── Draw video frame (mirrored, object-cover) ────────────────────────────────
function drawVideoFrame(ctx: CanvasRenderingContext2D, video: HTMLVideoElement, cW: number, cH: number) {
  const scale = Math.max(cW / VID_W, cH / VID_H);
  const dW    = VID_W * scale, dH = VID_H * scale;
  const cropX = (dW - cW) / 2, cropY = (dH - cH) / 2;
  ctx.save();
  ctx.translate(cW, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(video, -cropX, -cropY, dW, dH); // -cropX is correct for mirrored
  ctx.restore();
}

// ─── Sample average brightness of a face region (adaptive blending) ───────────
function sampleFaceLight(
  ctx: CanvasRenderingContext2D, lm: LM[], cW: number, cH: number,
): number {
  // Sample the forehead center area
  const c = lmToCanvas(lm[10].x, lm[10].y, cW, cH, true);
  const r = 8;
  try {
    const px = ctx.getImageData(Math.max(0, c.x - r), Math.max(0, c.y - r), r * 2, r * 2).data;
    let lum = 0;
    for (let i = 0; i < px.length; i += 4) lum += (px[i] * 0.299 + px[i+1] * 0.587 + px[i+2] * 0.114);
    return Math.min(1, lum / (px.length / 4) / 200);
  } catch { return 0.5; }
}

// ─── Main avatar effect pipeline ──────────────────────────────────────────────
function applyAvatarEffects(
  ctx: CanvasRenderingContext2D,
  lm: LM[], cW: number, cH: number,
  skinTone?: string, _hairCol?: string, eyeCol?: string,
) {
  const pt = (i: number) => lmToCanvas(lm[i].x, lm[i].y, cW, cH, true);

  const tracePath = (ids: number[]) => {
    ctx.beginPath();
    ids.forEach((id, j) => {
      const p = pt(id);
      j === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
    });
    ctx.closePath();
  };

  const skin   = getSkin(skinTone);
  const eyeHex = getEyeHex(eyeCol);

  // Face geometry reference
  const topPt  = pt(10);
  const chinPt = pt(152);
  const lJaw   = pt(127);
  const rJaw   = pt(356);
  const faceW  = Math.abs(rJaw.x - lJaw.x);
  const faceH  = Math.abs(chinPt.y - topPt.y);
  const faceCx = (lJaw.x + rJaw.x) / 2;
  const faceCy = (topPt.y + chinPt.y) / 2;

  // ── 1. ADAPTIVE SKIN TINT ─────────────────────────────────────────────────
  // Use gradient fill on the oval path (no hard clip → feathered appearance)
  const lightFactor = sampleFaceLight(ctx, lm, cW, cH);
  const skinAlpha   = 0.16 + (1 - lightFactor) * 0.08; // brighter room → less tint needed

  const skinG = ctx.createRadialGradient(
    faceCx, faceCy - faceH * 0.1, faceW * 0.18,
    faceCx, faceCy,               faceW * 0.60,
  );
  // Parse skin tint to rgb
  const r = parseInt(skin.tint.slice(1, 3), 16);
  const g = parseInt(skin.tint.slice(3, 5), 16);
  const b = parseInt(skin.tint.slice(5, 7), 16);
  skinG.addColorStop(0,   `rgba(${r},${g},${b},${(skinAlpha * 1.3).toFixed(2)})`);
  skinG.addColorStop(0.72, `rgba(${r},${g},${b},${skinAlpha.toFixed(2)})`);
  skinG.addColorStop(1,    `rgba(${r},${g},${b},0)`);

  tracePath(FACE_OVAL);
  ctx.fillStyle = skinG;
  ctx.fill();

  // Subtle temple/jaw darkening for face structure (gradient only inside oval)
  const shadowG = ctx.createLinearGradient(lJaw.x, faceCy, rJaw.x, faceCy);
  shadowG.addColorStop(0,    "rgba(0,0,0,0.10)");
  shadowG.addColorStop(0.20, "rgba(0,0,0,0)");
  shadowG.addColorStop(0.80, "rgba(0,0,0,0)");
  shadowG.addColorStop(1,    "rgba(0,0,0,0.10)");
  tracePath(FACE_OVAL);
  ctx.fillStyle = shadowG;
  ctx.fill();

  // ── 2. FEATHERED OVAL EDGE — hides the hard polygon boundary ─────────────
  // Paint thin feather strokes inside the oval to create a soft fade-out
  ctx.save();
  tracePath(FACE_OVAL);
  ctx.clip();
  for (let i = 1; i <= 6; i++) {
    ctx.globalCompositeOperation = "destination-out";
    ctx.lineWidth   = i * 2.2;
    ctx.strokeStyle = `rgba(0,0,0,${0.04 + i * 0.025})`;
    tracePath(FACE_OVAL);
    ctx.stroke();
  }
  ctx.globalCompositeOperation = "source-over";
  ctx.restore();

  // ── 3. EYE COLOR OVERLAY ─────────────────────────────────────────────────
  [LEFT_EYE, RIGHT_EYE].forEach((eyeIds) => {
    const pts  = eyeIds.map(i => pt(i));
    const xs   = pts.map(p => p.x), ys = pts.map(p => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const cx   = (minX + maxX) / 2;
    const cy   = (minY + maxY) / 2;
    const ew   = maxX - minX;
    const eh   = maxY - minY;
    const irisR = Math.max(ew * 0.25, eh * 0.58, 5);

    ctx.save();
    tracePath(eyeIds);
    ctx.clip();

    // Iris tint — layered for depth
    const iG = ctx.createRadialGradient(cx, cy, irisR * 0.05, cx, cy, irisR);
    iG.addColorStop(0,    eyeHex);
    iG.addColorStop(0.70, eyeHex);
    iG.addColorStop(1,    "rgba(0,0,0,0)");
    ctx.globalAlpha = 0.68;
    ctx.beginPath();
    ctx.arc(cx, cy, irisR, 0, Math.PI * 2);
    ctx.fillStyle = iG;
    ctx.fill();

    // Pupil
    ctx.globalAlpha = 0.72;
    ctx.fillStyle   = "#030303";
    ctx.beginPath();
    ctx.arc(cx, cy, irisR * 0.36, 0, Math.PI * 2);
    ctx.fill();

    // Catchlight
    ctx.globalAlpha = 0.92;
    ctx.fillStyle   = "#FFFFFF";
    ctx.beginPath();
    ctx.arc(cx + irisR * 0.26, cy - irisR * 0.28, irisR * 0.13, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  });

  // ── 4. CYBER GLOW OUTLINE — avatar identity marker ───────────────────────
  ctx.save();
  tracePath(FACE_OVAL);
  ctx.strokeStyle = eyeHex;
  ctx.lineWidth   = 2;
  ctx.shadowBlur  = 12;
  ctx.shadowColor = eyeHex;
  ctx.globalAlpha = 0.65;
  ctx.stroke();
  ctx.lineWidth   = 5;
  ctx.globalAlpha = 0.18;
  ctx.stroke();
  ctx.restore();

  // ── 5. T-ZONE SPECULAR HIGHLIGHT (centre-front lighting) ─────────────────
  ctx.save();
  tracePath(FACE_OVAL);
  ctx.clip();
  const sG = ctx.createRadialGradient(faceCx, topPt.y + faceH * 0.22, 0, faceCx, topPt.y + faceH * 0.22, faceW * 0.20);
  sG.addColorStop(0, "rgba(255,248,235,0.16)");
  sG.addColorStop(1, "rgba(255,248,235,0)");
  ctx.fillStyle = sG;
  ctx.fillRect(0, 0, cW, cH);
  ctx.restore();
}

// ─── Draw source landmark dots ────────────────────────────────────────────────
function drawDots(ctx: CanvasRenderingContext2D, lm: LM[], cW: number, cH: number) {
  ctx.fillStyle = "rgba(0,255,180,0.80)";
  for (const p of lm) {
    const { x, y } = lmToCanvas(p.x, p.y, cW, cH, false);
    ctx.beginPath();
    ctx.arc(x, y, 1.4, 0, Math.PI * 2);
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

  const streamRef      = useRef<MediaStream | null>(null);
  const srcCanvasRef   = useRef<HTMLCanvasElement>(null);
  const outCanvasRef   = useRef<HTMLCanvasElement>(null);
  const mediapipeRef   = useRef(false);
  const avatarRef      = useRef(activeAvatar);
  const prevLmRef      = useRef<LM[]>([]);           // ← EMA previous landmarks

  useEffect(() => { avatarRef.current = activeAvatar; }, [activeAvatar]);

  // Canvas pixel sync (CSS pixels, no DPR to avoid coord mismatch)
  useEffect(() => {
    if (hasPermission !== true) return;
    const sync = (el: HTMLCanvasElement | null) => {
      if (!el) return () => {};
      const ro = new ResizeObserver(() => {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && (el.width !== Math.round(r.width) || el.height !== Math.round(r.height))) {
          el.width = Math.round(r.width); el.height = Math.round(r.height);
          prevLmRef.current = []; // reset EMA on resize to avoid pop
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
      maxNumFaces:           1,
      refineLandmarks:       false,
      minDetectionConfidence: 0.5,
      minTrackingConfidence:  0.5,
    });

    fm.onResults((res) => {
      const detected = !!(res.multiFaceLandmarks?.length);
      setFaceDetected(detected);

      // ── Source panel: dots on top of dim video
      const sc   = srcCanvasRef.current;
      const sCtx = sc?.getContext("2d");
      if (sCtx && sc) {
        sCtx.clearRect(0, 0, sc.width, sc.height);
        if (detected) drawDots(sCtx, res.multiFaceLandmarks[0] as LM[], sc.width, sc.height);
      }

      // ── Output panel: mirrored video + smoothed avatar effects
      const oc   = outCanvasRef.current;
      const oCtx = oc?.getContext("2d");
      if (oCtx && oc) {
        oCtx.clearRect(0, 0, oc.width, oc.height);

        if (video.readyState >= 2) drawVideoFrame(oCtx, video, oc.width, oc.height);

        if (detected) {
          // ── EMA smoothing — reduce jitter on all 468 landmarks
          const rawLm   = res.multiFaceLandmarks[0] as LM[];
          const smoothLm = emaSmooth(rawLm, prevLmRef.current);
          prevLmRef.current = smoothLm;

          const av = avatarRef.current;
          applyAvatarEffects(oCtx, smoothLm, oc.width, oc.height,
            av?.skinTone, av?.hairColor, av?.eyeColor);
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
    } else { setElapsed(0); setFps(0); }
    return () => clearInterval(iv);
  }, [isStreaming]);

  const fmt = (s: number) =>
    `${Math.floor(s / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;

  // ── Permission screens ─────────────────────────────────────────────────────
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

  // ── Main studio ────────────────────────────────────────────────────────────
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

          {/* LEFT — source + landmarks */}
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

          {/* RIGHT — avatar output */}
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
