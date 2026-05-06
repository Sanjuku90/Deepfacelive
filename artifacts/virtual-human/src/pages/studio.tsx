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

// ─── Landmark index groups (MediaPipe Face Mesh, 468 pts) ─────────────────────
const FACE_OVAL = [10,338,297,332,284,251,389,356,454,323,361,288,397,365,379,378,400,377,152,148,176,149,150,136,172,58,132,93,234,127,162,21,54,103,67,109];
const LEFT_EYE  = [33,7,163,144,145,153,154,155,133,173,157,158,159,160,161,246];
const RIGHT_EYE = [362,382,381,380,374,373,390,249,263,466,388,387,386,385,384,398];
// 5-point brow (single lower edge row — avoids overly-thick strokes)
const LEFT_BROW = [55, 65, 52, 53, 46];
const RIGHT_BROW= [285, 295, 282, 283, 276];
const LIPS_OUT  = [61,185,40,39,37,0,267,269,270,409,291,375,321,405,314,17,84,181,91,146];
const LIPS_IN   = [78,191,80,81,82,13,312,311,310,415,308,324,318,402,317,14,87,178,88,95];

// MediaPipe Camera sends frames at this resolution
const VID_W = 640;
const VID_H = 480;

// ─── Object-cover transform ────────────────────────────────────────────────────
// Maps a normalized landmark (lm.x ∈ [0,1], lm.y ∈ [0,1]) from the video frame
// to canvas device-pixel coordinates, applying the same crop that CSS object-cover does.
// mirrored=true: also flips x to match a scaleX(-1) video element.
function lmToCanvas(
  lmX: number, lmY: number,
  canW: number, canH: number,
  mirrored: boolean,
): { x: number; y: number } {
  // object-cover scale: pick the dimension that fills the canvas
  const scaleX = canW / VID_W;
  const scaleY = canH / VID_H;
  const scale  = Math.max(scaleX, scaleY);

  // offset of the top-left corner of the scaled video within the canvas
  const offX = (VID_W * scale - canW) / 2;
  const offY = (VID_H * scale - canH) / 2;

  const vx = mirrored ? (1 - lmX) : lmX;
  return {
    x: vx * VID_W * scale - offX,
    y: lmY * VID_H * scale - offY,
  };
}

// ─── Color helpers ─────────────────────────────────────────────────────────────
function getSkin(tone?: string) {
  switch ((tone ?? "").toLowerCase()) {
    case "light": return { base: "#F5CBA7", shadow: "#C49070", highlight: "#FFE8C8" };
    case "dark":  return { base: "#8B5E3C", shadow: "#5A3820", highlight: "#A87050" };
    default:      return { base: "#D4956A", shadow: "#A06840", highlight: "#E8B080" };
  }
}
function getHair(color?: string): string {
  switch ((color ?? "").toLowerCase()) {
    case "black":  return "#1C1C1C";
    case "brown":  return "#6B4226";
    case "blonde": return "#C8920A";
    case "red":    return "#B83020";
    case "white":  return "#D8D0C0";
    default:       return "#1C1C1C";
  }
}
function getEye(color?: string): string {
  switch ((color ?? "").toLowerCase()) {
    case "blue":   return "#3A7DC9";
    case "green":  return "#2E8B57";
    case "gray":   return "#708090";
    case "cyan":   return "#00A0B0";
    case "purple": return "#7B35A0";
    default:       return "#7B5726"; // brown
  }
}
function getLip(skinTone?: string) {
  switch ((skinTone ?? "").toLowerCase()) {
    case "dark":  return { fill: "#904040", shadow: "#602020" };
    case "light": return { fill: "#D08878", shadow: "#A05050" };
    default:      return { fill: "#B86860", shadow: "#904850" };
  }
}

type LM = { x: number; y: number; z: number };

// ─── Realistic face renderer ───────────────────────────────────────────────────
function drawFace(
  ctx: CanvasRenderingContext2D,
  lm: LM[],
  canW: number,
  canH: number,
  skinTone?: string,
  hairCol?: string,
  eyeCol?: string,
  mirrored = true,
) {
  // Map a landmark index to canvas coordinates, applying object-cover alignment
  const pt = (i: number) => lmToCanvas(lm[i].x, lm[i].y, canW, canH, mirrored);

  // Draw a closed/open path from an array of landmark indices
  const path = (indices: number[], close = true) => {
    ctx.beginPath();
    indices.forEach((i, j) => {
      const { x, y } = pt(i);
      j === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    if (close) ctx.closePath();
  };

  const skin = getSkin(skinTone);
  const hair = getHair(hairCol);
  const eye  = getEye(eyeCol);
  const lip  = getLip(skinTone);

  // ── Reference measurements ──────────────────────────────────────
  const topHead = pt(10);
  const foreL   = pt(109);
  const foreR   = pt(338);
  const chin    = pt(152);
  // Face width from left jaw to right jaw
  const faceW   = Math.abs(pt(356).x - pt(127).x);

  // ── 1. EARS ────────────────────────────────────────────────────
  const lEar = pt(234);
  const rEar = pt(454);
  const earH = Math.abs(pt(127).y - pt(234).y) * 0.42 + faceW * 0.03;
  const earW = earH * 0.55;

  ctx.save();
  ctx.fillStyle   = skin.base;
  ctx.strokeStyle = skin.shadow;
  ctx.lineWidth   = 1;
  // left ear
  ctx.beginPath();
  ctx.ellipse(lEar.x - earW * 0.35, lEar.y, earW, earH, 0, 0, Math.PI * 2);
  ctx.fill(); ctx.stroke();
  // right ear
  ctx.beginPath();
  ctx.ellipse(rEar.x + earW * 0.35, rEar.y, earW, earH, 0, 0, Math.PI * 2);
  ctx.fill(); ctx.stroke();
  ctx.restore();

  // ── 2. HAIR CAP (tight to skull, natural hairline) ─────────────
  const hairH = faceW * 0.20; // keep close to skull
  ctx.save();
  ctx.fillStyle = hair;
  ctx.beginPath();
  ctx.moveTo(foreL.x - faceW * 0.05, foreL.y + faceW * 0.02);
  ctx.bezierCurveTo(
    foreL.x - faceW * 0.07, topHead.y - hairH,
    foreR.x + faceW * 0.07, topHead.y - hairH,
    foreR.x + faceW * 0.05, foreR.y + faceW * 0.02,
  );
  ctx.lineTo(foreR.x, foreR.y);
  ctx.lineTo(topHead.x, topHead.y);
  ctx.lineTo(foreL.x, foreL.y);
  ctx.closePath();
  ctx.fill();
  // sheen
  const hg = ctx.createLinearGradient(topHead.x - faceW * 0.1, topHead.y - hairH, topHead.x + faceW * 0.2, topHead.y);
  hg.addColorStop(0, "rgba(255,255,255,0.09)");
  hg.addColorStop(0.4, "rgba(255,255,255,0)");
  ctx.fillStyle = hg;
  ctx.fill();
  ctx.restore();

  // ── 3. FACE OVAL (skin base) ───────────────────────────────────
  path(FACE_OVAL);
  ctx.fillStyle = skin.base;
  ctx.fill();

  // Forehead highlight → chin shadow gradient
  const sg = ctx.createLinearGradient(topHead.x, topHead.y, topHead.x, chin.y);
  sg.addColorStop(0,    "rgba(255,240,210,0.22)");
  sg.addColorStop(0.30, "rgba(255,255,255,0)");
  sg.addColorStop(1,    "rgba(0,0,0,0.20)");
  path(FACE_OVAL);
  ctx.fillStyle = sg;
  ctx.fill();

  // Subtle cheek blush
  const blushR = faceW * 0.11;
  [pt(50), pt(280)].forEach(c => {
    const bg = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, blushR);
    bg.addColorStop(0, "rgba(220,100,85,0.12)");
    bg.addColorStop(1, "rgba(220,100,85,0)");
    ctx.beginPath();
    ctx.arc(c.x, c.y, blushR, 0, Math.PI * 2);
    ctx.fillStyle = bg;
    ctx.fill();
  });

  // ── 4. EYEBROWS ────────────────────────────────────────────────
  const browCol = hair === "#D8D0C0" ? "#908060" : hair;
  ctx.save();
  ctx.strokeStyle = browCol;
  ctx.lineWidth   = faceW * 0.015; // thin and natural
  ctx.lineCap     = "round";
  ctx.lineJoin    = "round";
  [LEFT_BROW, RIGHT_BROW].forEach(brow => {
    const pts = brow.map(i => pt(i));
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    pts.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
    ctx.stroke();
  });
  ctx.restore();

  // ── 5. EYES ────────────────────────────────────────────────────
  const drawEye = (indices: number[]) => {
    const pts  = indices.map(i => pt(i));
    const xs   = pts.map(p => p.x);
    const ys   = pts.map(p => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const cx   = (minX + maxX) / 2;
    const cy   = (minY + maxY) / 2;
    const eh   = maxY - minY;
    // Iris ~50% of opening height → human proportion
    const irisR = Math.max(eh * 0.50, 2);

    ctx.save();
    path(indices);
    ctx.clip();

    // Sclera (warm white)
    ctx.fillStyle = "#F6F0EA";
    ctx.fill();

    // Iris with radial gradient
    const ig = ctx.createRadialGradient(cx, cy - irisR * 0.08, 0, cx, cy, irisR);
    ig.addColorStop(0,    eye);
    ig.addColorStop(0.72, eye);
    ig.addColorStop(1,    skin.shadow);
    ctx.beginPath();
    ctx.arc(cx, cy, irisR, 0, Math.PI * 2);
    ctx.fillStyle = ig;
    ctx.fill();

    // Dark iris limbal ring
    ctx.beginPath();
    ctx.arc(cx, cy, irisR, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(0,0,0,0.30)";
    ctx.lineWidth   = irisR * 0.12;
    ctx.stroke();

    // Pupil
    ctx.beginPath();
    ctx.arc(cx, cy, irisR * 0.42, 0, Math.PI * 2);
    ctx.fillStyle = "#080808";
    ctx.fill();

    // Primary specular catchlight
    ctx.beginPath();
    ctx.arc(cx + irisR * 0.28, cy - irisR * 0.28, irisR * 0.18, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.90)";
    ctx.fill();

    // Tiny secondary catchlight
    ctx.beginPath();
    ctx.arc(cx - irisR * 0.20, cy + irisR * 0.20, irisR * 0.08, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.40)";
    ctx.fill();

    ctx.restore();

    // Upper eyelid shade (depth)
    ctx.save();
    path(indices);
    ctx.clip();
    const lg = ctx.createLinearGradient(cx, minY, cx, cy);
    lg.addColorStop(0, "rgba(0,0,0,0.25)");
    lg.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillRect(minX - 2, minY, maxX - minX + 4, (maxY - minY) * 0.55);
    ctx.fillStyle = lg;
    ctx.fill();
    ctx.restore();

    // Lash line
    ctx.save();
    path(indices);
    ctx.strokeStyle = "#0A0A0A";
    ctx.lineWidth   = 1.5;
    ctx.stroke();
    ctx.restore();
  };

  drawEye(LEFT_EYE);
  drawEye(RIGHT_EYE);

  // ── 6. NOSE ────────────────────────────────────────────────────
  const nTop = pt(6);
  const tip  = pt(4);
  const nL   = pt(239);
  const nR   = pt(459);
  const nW   = Math.abs(nR.x - nL.x);

  ctx.save();
  ctx.strokeStyle = skin.shadow;
  ctx.lineCap     = "round";

  // Nose bridge shadow lines (subtle)
  ctx.globalAlpha = 0.28;
  ctx.lineWidth   = Math.max(nW * 0.06, 1);
  ctx.beginPath();
  ctx.moveTo(nTop.x - nW * 0.10, nTop.y);
  ctx.quadraticCurveTo(tip.x - nW * 0.22, tip.y - nW * 0.18, tip.x - nW * 0.12, tip.y - nW * 0.04);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(nTop.x + nW * 0.10, nTop.y);
  ctx.quadraticCurveTo(tip.x + nW * 0.22, tip.y - nW * 0.18, tip.x + nW * 0.12, tip.y - nW * 0.04);
  ctx.stroke();

  // Nose tip highlight
  ctx.globalAlpha = 0.22;
  ctx.fillStyle   = skin.highlight;
  ctx.beginPath();
  ctx.ellipse(tip.x, tip.y - nW * 0.06, nW * 0.12, nW * 0.09, 0, 0, Math.PI * 2);
  ctx.fill();

  // Nostrils
  ctx.globalAlpha = 0.48;
  ctx.fillStyle   = skin.shadow;
  ctx.beginPath();
  ctx.ellipse(nL.x - nW * 0.02, nL.y + nW * 0.06, nW * 0.17, nW * 0.12, -0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(nR.x + nW * 0.02, nR.y + nW * 0.06, nW * 0.17, nW * 0.12, 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // ── 7. LIPS ────────────────────────────────────────────────────
  // Outer lip fill
  path(LIPS_OUT);
  ctx.fillStyle = lip.fill;
  ctx.fill();

  // Inner mouth (open-mouth dark area)
  path(LIPS_IN);
  ctx.fillStyle = "rgba(30,10,10,0.70)";
  ctx.fill();

  // Upper lip Cupid's bow highlight
  ctx.save();
  const lhg = ctx.createLinearGradient(pt(0).x, pt(37).y, pt(0).x, pt(17).y);
  lhg.addColorStop(0, "rgba(255,210,195,0.38)");
  lhg.addColorStop(0.6, "rgba(255,210,195,0)");
  path(LIPS_OUT.slice(0, 11));
  ctx.fillStyle = lhg;
  ctx.fill();
  ctx.restore();

  // Lower lip center highlight
  ctx.save();
  const lm17 = pt(17);
  const llg = ctx.createRadialGradient(lm17.x, lm17.y, 0, lm17.x, lm17.y, faceW * 0.08);
  llg.addColorStop(0, "rgba(255,210,195,0.28)");
  llg.addColorStop(1, "rgba(255,210,195,0)");
  ctx.beginPath();
  ctx.ellipse(lm17.x, lm17.y - faceW * 0.008, faceW * 0.07, faceW * 0.024, 0, 0, Math.PI * 2);
  ctx.fillStyle = llg;
  ctx.fill();
  ctx.restore();

  // Lip outline
  path(LIPS_OUT);
  ctx.strokeStyle = lip.shadow;
  ctx.lineWidth   = 0.7;
  ctx.stroke();
}

// ─── Main Studio component ─────────────────────────────────────────────────────
export default function Studio() {
  const { data: activeAvatar } = useGetActiveAvatar();
  const { data: config } = useGetConfig();

  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [faceDetected, setFaceDetected] = useState(false);
  const [fps, setFps] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [audioLevel, setAudioLevel] = useState(0);
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);

  const streamRef       = useRef<MediaStream | null>(null);
  const sourceCanvasRef = useRef<HTMLCanvasElement>(null);
  const outputCanvasRef = useRef<HTMLCanvasElement>(null);
  const outputVideoRef  = useRef<HTMLVideoElement>(null);
  const mediapipeInitRef = useRef(false);
  const avatarRef = useRef(activeAvatar);
  useEffect(() => { avatarRef.current = activeAvatar; }, [activeAvatar]);

  // Bind the output video element to the stream when permission is granted
  useEffect(() => {
    if (hasPermission && streamRef.current && outputVideoRef.current) {
      outputVideoRef.current.srcObject = streamRef.current;
      outputVideoRef.current.play().catch(() => {});
    }
  }, [hasPermission]);

  // Keep canvas pixel dimensions in sync with CSS layout (DPR-aware)
  useEffect(() => {
    if (hasPermission !== true) return;

    const syncCanvas = (el: HTMLCanvasElement | null) => {
      if (!el) return () => {};
      const resize = () => {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        const dpr = window.devicePixelRatio || 1;
        const newW = Math.round(rect.width  * dpr);
        const newH = Math.round(rect.height * dpr);
        if (el.width !== newW || el.height !== newH) {
          el.width  = newW;
          el.height = newH;
        }
      };
      const ro = new ResizeObserver(resize);
      ro.observe(el);
      requestAnimationFrame(resize);
      return () => ro.disconnect();
    };

    const c1 = syncCanvas(sourceCanvasRef.current);
    const c2 = syncCanvas(outputCanvasRef.current);
    return () => { c1(); c2(); };
  }, [hasPermission]);

  const requestPermissions = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      streamRef.current = stream;
      setHasPermission(true);
    } catch {
      setHasPermission(false);
    }
  };

  const initAudioAnalysis = useCallback((stream: MediaStream) => {
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    ctx.createMediaStreamSource(stream).connect(analyser);
    analyser.fftSize = 256;
    const buf = new Uint8Array(analyser.frequencyBinCount);
    let active = true;
    const tick = () => {
      if (!active) return;
      analyser.getByteFrequencyData(buf);
      setAudioLevel(buf.reduce((a, b) => a + b, 0) / buf.length / 255);
      requestAnimationFrame(tick);
    };
    tick();
    return () => { active = false; };
  }, []);

  const initMediaPipe = useCallback((stream: MediaStream, video: HTMLVideoElement) => {
    if (mediapipeInitRef.current) return;
    mediapipeInitRef.current = true;
    video.srcObject = stream;
    video.play().catch(() => {});

    const faceMesh = new FaceMesh({
      locateFile: (file) =>
        `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4/${file}`,
    });
    faceMesh.setOptions({
      maxNumFaces: 1,
      refineLandmarks: false,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });

    faceMesh.onResults((results) => {
      const detected = !!(results.multiFaceLandmarks?.length);
      setFaceDetected(detected);

      // ── Source panel: cyan landmark dots (no mirroring, video is raw) ──
      const sc   = sourceCanvasRef.current;
      const sCtx = sc?.getContext("2d");
      if (sCtx && sc) {
        sCtx.clearRect(0, 0, sc.width, sc.height);
        if (detected) {
          sCtx.fillStyle = "rgba(0,255,200,0.72)";
          for (const p of results.multiFaceLandmarks[0]) {
            // Apply same object-cover transform so dots sit on the face in the video
            const { x, y } = lmToCanvas(p.x, p.y, sc.width, sc.height, false);
            sCtx.beginPath();
            sCtx.arc(x, y, 1.5, 0, Math.PI * 2);
            sCtx.fill();
          }
        }
      }

      // ── Output panel: realistic face (mirrored to match scaleX(-1) video) ──
      const oc   = outputCanvasRef.current;
      const oCtx = oc?.getContext("2d");
      if (oCtx && oc) {
        oCtx.clearRect(0, 0, oc.width, oc.height);
        if (detected) {
          const av = avatarRef.current;
          drawFace(
            oCtx,
            results.multiFaceLandmarks[0] as LM[],
            oc.width, oc.height,
            av?.skinTone, av?.hairColor, av?.eyeColor,
            true,
          );
        }
      }
    });

    const cam = new Camera(video, {
      onFrame: async () => {
        if (video.readyState >= 2) await faceMesh.send({ image: video });
      },
      width: VID_W,
      height: VID_H,
    });
    cam.start();
  }, []);

  useEffect(() => {
    if (hasPermission !== true || !streamRef.current || !videoEl) return;
    const stream = streamRef.current;
    const cleanup = initAudioAnalysis(stream);
    const t = setTimeout(() => initMediaPipe(stream, videoEl), 120);
    return () => { clearTimeout(t); cleanup?.(); };
  }, [hasPermission, videoEl, initAudioAnalysis, initMediaPipe]);

  useEffect(() => {
    let iv: ReturnType<typeof setInterval>;
    if (isStreaming) {
      iv = setInterval(() => {
        setElapsed(e => e + 1);
        setFps(Math.floor(Math.random() * 5 + 55));
      }, 1000);
    } else { setElapsed(0); setFps(0); }
    return () => clearInterval(iv);
  }, [isStreaming]);

  const fmt = (s: number) =>
    `${Math.floor(s / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;

  // ── Permission screens ─────────────────────────────────────────
  if (hasPermission === false) {
    return (
      <Layout>
        <div className="flex-1 flex items-center justify-center">
          <div className="max-w-md text-center space-y-6 p-8 border border-destructive/20 bg-destructive/5 rounded-lg">
            <Video className="w-12 h-12 text-destructive mx-auto" />
            <h2 className="text-xl font-bold text-destructive">Accès caméra refusé</h2>
            <p className="text-muted-foreground">Autorisez la caméra et le micro dans votre navigateur.</p>
            <Button onClick={() => { mediapipeInitRef.current = false; requestPermissions(); }} className="w-full">
              Réessayer
            </Button>
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
            <p className="text-muted-foreground text-sm">
              Accès caméra + micro requis pour le tracking facial en temps réel.
            </p>
            <Button onClick={requestPermissions} size="lg" className="w-full font-bold uppercase tracking-wider">
              Grant Access
            </Button>
          </div>
        </div>
      </Layout>
    );
  }

  // ── Main studio view ───────────────────────────────────────────
  return (
    <Layout>
      <div className="flex flex-col h-full bg-background p-4 gap-4">

        {/* Top bar */}
        <div className="flex items-center justify-between bg-card border border-border p-3 rounded-lg shrink-0">
          <div className="flex items-center gap-4">
            <Badge variant="outline" className="font-mono text-xs uppercase bg-black/40 border-primary/30 text-primary">
              <Zap className="w-3 h-3 mr-1 inline" />
              {activeAvatar?.name ?? "No Avatar"}
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
            {isStreaming ? (
              <Button variant="destructive" size="sm" onClick={() => setIsStreaming(false)} className="animate-pulse">
                <Square className="w-4 h-4 mr-2 fill-current" /> STOP
              </Button>
            ) : (
              <Button size="sm" onClick={() => setIsStreaming(true)} className="bg-emerald-600 hover:bg-emerald-500 text-white">
                <Play className="w-4 h-4 mr-2 fill-current" /> GO LIVE
              </Button>
            )}
          </div>
        </div>

        {/* Panels */}
        <div className="flex-1 flex gap-4 min-h-0">

          {/* LEFT: source webcam + landmark dots */}
          <div className="w-[38%] flex flex-col gap-3 min-h-0">
            <div className="flex-1 relative bg-black rounded-lg overflow-hidden border border-border min-h-0">
              <video
                ref={(el) => { if (el && el !== videoEl) setVideoEl(el); }}
                autoPlay playsInline muted
                className="absolute inset-0 w-full h-full object-cover opacity-50"
              />
              <canvas
                ref={sourceCanvasRef}
                className="absolute inset-0 w-full h-full"
              />
              <div className="absolute top-3 left-3 font-mono text-xs text-primary/70 bg-black/60 px-2 py-1 rounded">
                SOURCE
              </div>
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

          {/* RIGHT: realistic face avatar output */}
          <div className="flex-1 relative rounded-lg overflow-hidden border border-border bg-black min-h-0">
            {/* Mirrored webcam background */}
            <video
              ref={outputVideoRef}
              autoPlay playsInline muted
              className="absolute inset-0 w-full h-full object-cover"
              style={{ transform: "scaleX(-1)" }}
            />
            {/* Realistic face canvas (no CSS transform — drawn with mirrored coords) */}
            <canvas
              ref={outputCanvasRef}
              className="absolute inset-0 w-full h-full"
            />

            <div className="absolute top-3 right-3 font-mono text-xs text-emerald-400 bg-black/60 px-2 py-1 rounded flex items-center gap-2 pointer-events-none">
              <span className={`w-2 h-2 rounded-full ${isStreaming ? "bg-red-500 animate-pulse" : "bg-border"}`} />
              {isStreaming ? "LIVE OUTPUT" : "PREVIEW"}
            </div>
            <div className="absolute bottom-3 left-3 font-mono text-xs text-white/50 bg-black/40 px-2 py-1 rounded pointer-events-none">
              AVATAR: {activeAvatar?.name?.toUpperCase() ?? "NONE"}
            </div>

            {!faceDetected && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <p className="font-mono text-xs text-white/20 uppercase tracking-widest animate-pulse">
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
