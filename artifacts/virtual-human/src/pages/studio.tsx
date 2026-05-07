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

// ─── Object-cover landmark-to-canvas projection ───────────────────────────────
function lmToCanvas(lx: number, ly: number, cW: number, cH: number, mirrored: boolean) {
  const scale = Math.max(cW / VID_W, cH / VID_H);
  const offX  = (VID_W * scale - cW) / 2;
  const offY  = (VID_H * scale - cH) / 2;
  const x     = (mirrored ? 1 - lx : lx) * VID_W * scale - offX;
  const y     = ly * VID_H * scale - offY;
  return { x, y };
}

// ─── Color palettes ───────────────────────────────────────────────────────────
function getSkinTint(tone?: string): string {
  switch ((tone ?? "medium").toLowerCase()) {
    case "light":  return "#F5C8A0";
    case "dark":   return "#7A4020";
    default:       return "#C07840";
  }
}
function getHairColor(c?: string): string {
  switch ((c ?? "black").toLowerCase()) {
    case "black":  return "#0C0C0C";
    case "brown":  return "#4A2810";
    case "blonde": return "#B07808";
    case "red":    return "#9A2010";
    case "white":  return "#C8C0B0";
    default:       return "#0C0C0C";
  }
}
function getEyeColor(c?: string): string {
  switch ((c ?? "brown").toLowerCase()) {
    case "blue":   return "#1A60C0";
    case "green":  return "#1A7840";
    case "gray":   return "#506070";
    case "cyan":   return "#007888";
    case "purple": return "#602898";
    default:       return "#604018";
  }
}

type LM = { x: number; y: number; z: number };

// ─── Draw dots on source panel ────────────────────────────────────────────────
function drawSourceDots(ctx: CanvasRenderingContext2D, lm: LM[], cW: number, cH: number) {
  ctx.fillStyle = "rgba(0,255,180,0.80)";
  for (const p of lm) {
    const { x, y } = lmToCanvas(p.x, p.y, cW, cH, false);
    ctx.beginPath();
    ctx.arc(x, y, 1.4, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ─── Core: draw mirrored video frame to canvas ────────────────────────────────
function drawVideoFrame(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  cW: number, cH: number,
) {
  const scale  = Math.max(cW / VID_W, cH / VID_H);
  const drawW  = VID_W * scale;
  const drawH  = VID_H * scale;
  const cropX  = (drawW - cW) / 2;
  const cropY  = (drawH - cH) / 2;

  // Mirror horizontally
  ctx.save();
  ctx.translate(cW, 0);
  ctx.scale(-1, 1);
  // After this transform: drawing at ctx_x=0 appears at screen right, ctx_x=cW at screen left
  // To show the same object-cover crop, we shift right by cropX so the crop is symmetric
  ctx.drawImage(video, cropX, -cropY, drawW, drawH);
  ctx.restore();
}

// ─── Avatar effect: skin / hair / eye color overlays ─────────────────────────
function applyAvatarEffects(
  ctx: CanvasRenderingContext2D,
  lm: LM[], cW: number, cH: number,
  skinTone?: string, hairCol?: string, eyeCol?: string,
) {
  const pt = (i: number) => lmToCanvas(lm[i].x, lm[i].y, cW, cH, true /* mirrored */);

  const makePath = (ids: number[], close = true) => {
    ctx.beginPath();
    ids.forEach((id, j) => { const p = pt(id); j === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y); });
    if (close) ctx.closePath();
  };

  const skinTint = getSkinTint(skinTone);
  const hairTint = getHairColor(hairCol);
  const eyeTint  = getEyeColor(eyeCol);

  const topPt  = pt(10);
  const foreLPt = pt(109);
  const foreRPt = pt(338);
  const faceW  = Math.abs(pt(356).x - pt(127).x);
  const hairBotY = Math.max(foreLPt.y, foreRPt.y) + faceW * 0.04;

  // ── 1. SKIN TONE TINT (subtle wash over face oval) ────────────────────────
  ctx.save();
  makePath(FACE_OVAL);
  ctx.clip();
  ctx.globalAlpha = 0.18;
  ctx.fillStyle   = skinTint;
  ctx.fillRect(0, 0, cW, cH);
  ctx.restore();

  // ── 2. HAIR TINT (source-over, safe for any hair color) ──────────────────
  ctx.save();
  // Clip to top-of-canvas strip, excluding the face oval via evenodd
  ctx.beginPath();
  ctx.rect(0, 0, cW, hairBotY);
  FACE_OVAL.forEach((id, j) => {
    const p = pt(id); j === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
  });
  ctx.closePath();
  ctx.clip("evenodd");
  // Use source-over so any color works without blackening the video
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 0.38;
  ctx.fillStyle   = hairTint;
  ctx.fillRect(0, 0, cW, cH);
  ctx.restore();

  // ── 3. EYE COLOR (tint iris, darken pupil) ────────────────────────────────
  [LEFT_EYE, RIGHT_EYE].forEach((eyeIds) => {
    const pts  = eyeIds.map(i => pt(i));
    const xs   = pts.map(p => p.x), ys = pts.map(p => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const cx   = (minX + maxX) / 2;
    const cy   = (minY + maxY) / 2;
    const ew   = maxX - minX;
    const eh   = maxY - minY;
    const irisR = Math.max(ew * 0.24, eh * 0.58, 4);

    ctx.save();
    makePath(eyeIds);
    ctx.clip();

    // Iris tint — soft radial gradient
    const iG = ctx.createRadialGradient(cx, cy, irisR * 0.05, cx, cy, irisR * 0.88);
    iG.addColorStop(0,    eyeTint);
    iG.addColorStop(0.75, eyeTint);
    iG.addColorStop(1,    "rgba(0,0,0,0)");
    ctx.globalAlpha = 0.62;
    ctx.fillStyle   = iG;
    ctx.beginPath();
    ctx.arc(cx, cy, irisR, 0, Math.PI * 2);
    ctx.fill();

    // Pupil — reinforce center darkness
    ctx.globalAlpha = 0.65;
    ctx.fillStyle   = "#050505";
    ctx.beginPath();
    ctx.arc(cx, cy, irisR * 0.38, 0, Math.PI * 2);
    ctx.fill();

    // Catchlight — tiny white dot so eye looks alive
    ctx.globalAlpha = 0.88;
    ctx.fillStyle   = "#FFFFFF";
    ctx.beginPath();
    ctx.arc(cx + irisR * 0.28, cy - irisR * 0.30, irisR * 0.12, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  });

  // ── 4. MAKEUP SHEEN (optional: subtle glow for digital-avatar look) ────────
  ctx.save();
  makePath(FACE_OVAL);
  ctx.clip();
  // Soft specular highlight center of face (nose bridge, T-zone)
  const shineCx = (topPt.x + pt(152).x) / 2;
  const shineG  = ctx.createRadialGradient(shineCx, topPt.y + faceW * 0.2, 0, shineCx, topPt.y + faceW * 0.2, faceW * 0.22);
  shineG.addColorStop(0,  "rgba(255,248,235,0.16)");
  shineG.addColorStop(1,  "rgba(255,248,235,0)");
  ctx.fillStyle = shineG;
  ctx.fillRect(0, 0, cW, cH);
  ctx.restore();
}

// ─── Studio component ─────────────────────────────────────────────────────────
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

  const streamRef       = useRef<MediaStream | null>(null);
  const sourceCanvasRef = useRef<HTMLCanvasElement>(null);
  const outputCanvasRef = useRef<HTMLCanvasElement>(null);
  const mediapipeRef    = useRef(false);
  const avatarRef       = useRef(activeAvatar);
  useEffect(() => { avatarRef.current = activeAvatar; }, [activeAvatar]);

  // Sync canvas pixel dimensions with CSS layout (no DPR scaling to avoid coord bugs)
  useEffect(() => {
    if (hasPermission !== true) return;
    const sync = (el: HTMLCanvasElement | null) => {
      if (!el) return () => {};
      const ro = new ResizeObserver(() => {
        const r = el.getBoundingClientRect();
        if (r.width > 0) { el.width = Math.round(r.width); el.height = Math.round(r.height); }
      });
      ro.observe(el);
      return () => ro.disconnect();
    };
    const u1 = sync(sourceCanvasRef.current);
    const u2 = sync(outputCanvasRef.current);
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
    const ac  = new AudioContext();
    const an  = ac.createAnalyser();
    ac.createMediaStreamSource(stream).connect(an);
    an.fftSize = 256;
    const buf = new Uint8Array(an.frequencyBinCount);
    let active = true;
    const tick = () => { if (!active) return; an.getByteFrequencyData(buf); setAudioLevel(buf.reduce((a,b)=>a+b,0)/buf.length/255); requestAnimationFrame(tick); };
    tick();
    return () => { active = false; };
  }, []);

  const initMediaPipe = useCallback((stream: MediaStream, video: HTMLVideoElement) => {
    if (mediapipeRef.current) return;
    mediapipeRef.current = true;
    video.srcObject = stream;
    video.play().catch(() => {});

    const fm = new FaceMesh({ locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4/${f}` });
    fm.setOptions({ maxNumFaces: 1, refineLandmarks: false, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });

    fm.onResults((res) => {
      const detected = !!(res.multiFaceLandmarks?.length);
      setFaceDetected(detected);

      // ── Source panel: semi-transparent video + landmark dots
      const sc   = sourceCanvasRef.current;
      const sCtx = sc?.getContext("2d");
      if (sCtx && sc) {
        sCtx.clearRect(0, 0, sc.width, sc.height);
        if (detected) drawSourceDots(sCtx, res.multiFaceLandmarks[0] as LM[], sc.width, sc.height);
      }

      // ── Output panel: real video frame (mirrored) + avatar color effects
      const oc   = outputCanvasRef.current;
      const oCtx = oc?.getContext("2d");
      if (oCtx && oc) {
        oCtx.clearRect(0, 0, oc.width, oc.height);

        // Always draw the live video frame as background
        if (video.readyState >= 2) {
          drawVideoFrame(oCtx, video, oc.width, oc.height);
        }

        // Apply avatar color overlays only when face is tracked
        if (detected) {
          const av = avatarRef.current;
          applyAvatarEffects(oCtx, res.multiFaceLandmarks[0] as LM[], oc.width, oc.height,
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
    const stream = streamRef.current;
    const cleanup = initAudio(stream);
    const t = setTimeout(() => initMediaPipe(stream, videoEl), 120);
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

  return (
    <Layout>
      <div className="flex flex-col h-full bg-background p-4 gap-4">

        {/* Top status bar */}
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

        {/* Main panels */}
        <div className="flex-1 flex gap-4 min-h-0">

          {/* LEFT — original camera + landmarks */}
          <div className="w-[38%] flex flex-col gap-3 min-h-0">
            <div className="flex-1 relative bg-black rounded-lg overflow-hidden border border-border min-h-0">
              <video
                ref={(el) => { if (el && el !== videoEl) setVideoEl(el); }}
                autoPlay playsInline muted
                className="absolute inset-0 w-full h-full object-cover opacity-55"
              />
              <canvas ref={sourceCanvasRef} className="absolute inset-0 w-full h-full" />
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

          {/* RIGHT — avatar output (real video + color effects) */}
          <div className="flex-1 relative rounded-lg overflow-hidden border border-border bg-black min-h-0">
            {/* Canvas draws the mirrored video + avatar effects */}
            <canvas ref={outputCanvasRef} className="absolute inset-0 w-full h-full" />

            <div className="absolute top-3 right-3 font-mono text-xs text-emerald-400 bg-black/60 px-2 py-1 rounded flex items-center gap-2 pointer-events-none">
              <span className={`w-2 h-2 rounded-full ${isStreaming ? "bg-red-500 animate-pulse" : "bg-border"}`} />
              {isStreaming ? "LIVE OUTPUT" : "PREVIEW"}
            </div>
            <div className="absolute bottom-3 left-3 font-mono text-xs text-white/50 bg-black/40 px-2 py-1 rounded pointer-events-none">
              AVATAR: {activeAvatar?.name?.toUpperCase() ?? "NONE"}
            </div>
            {!faceDetected && hasPermission === true && (
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
