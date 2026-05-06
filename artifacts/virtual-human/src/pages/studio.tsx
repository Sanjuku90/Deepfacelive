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

// ─── Face Mesh landmark groups ────────────────────────────────────────────────
const FACE_OVAL = [10,338,297,332,284,251,389,356,454,323,361,288,397,365,379,378,400,377,152,148,176,149,150,136,172,58,132,93,234,127,162,21,54,103,67,109];
const LEFT_EYE  = [33,7,163,144,145,153,154,155,133,173,157,158,159,160,161,246];
const RIGHT_EYE = [362,382,381,380,374,373,390,249,263,466,388,387,386,385,384,398];
// Upper eyelid only (for lash drawing)
const LEFT_EYE_UPPER  = [246,161,160,159,158,157,173,133];
const RIGHT_EYE_UPPER = [466,388,387,386,385,384,398,362];
const LIPS_OUT = [61,185,40,39,37,0,267,269,270,409,291,375,321,405,314,17,84,181,91,146];
const LIPS_IN  = [78,191,80,81,82,13,312,311,310,415,308,324,318,402,317,14,87,178,88,95];

const VID_W = 640;
const VID_H = 480;

// ─── Object-cover landmark projection ────────────────────────────────────────
function lmToCanvas(lx: number, ly: number, cW: number, cH: number, mirrored: boolean) {
  const scale = Math.max(cW / VID_W, cH / VID_H);
  const offX  = (VID_W * scale - cW) / 2;
  const offY  = (VID_H * scale - cH) / 2;
  const x     = (mirrored ? 1 - lx : lx) * VID_W * scale - offX;
  const y     = ly * VID_H * scale - offY;
  return { x, y };
}

// ─── Color palettes ───────────────────────────────────────────────────────────
function getSkin(tone?: string) {
  switch ((tone ?? "").toLowerCase()) {
    case "light": return { base: "#F2C9A0", shadow: "#C09060", hi: "#FFF0DC", deep: "#A06840" };
    case "dark":  return { base: "#8A5C38", shadow: "#50301A", hi: "#B07848", deep: "#3A2010" };
    default:      return { base: "#CF9060", shadow: "#9A6030", hi: "#E8B078", deep: "#7A4020" };
  }
}
function getHair(c?: string) {
  switch ((c ?? "").toLowerCase()) {
    case "black":  return "#1A1A1A";
    case "brown":  return "#5A3820";
    case "blonde": return "#C08010";
    case "red":    return "#AA2818";
    case "white":  return "#D0C8B8";
    default:       return "#1A1A1A";
  }
}
function getEye(c?: string) {
  switch ((c ?? "").toLowerCase()) {
    case "blue":   return "#2A70C8";
    case "green":  return "#228850";
    case "gray":   return "#607080";
    case "cyan":   return "#008898";
    case "purple": return "#6830A0";
    default:       return "#704820";
  }
}
function getLip(tone?: string) {
  switch ((tone ?? "").toLowerCase()) {
    case "dark":  return { fill: "#7A3030", mid: "#5A1818", hi: "rgba(200,140,120,0.35)" };
    case "light": return { fill: "#C07868", mid: "#904848", hi: "rgba(255,220,205,0.42)" };
    default:      return { fill: "#A85858", mid: "#783838", hi: "rgba(255,205,185,0.40)" };
  }
}

type LM = { x: number; y: number; z: number };

// ─── Modern face renderer ─────────────────────────────────────────────────────
function drawModernFace(
  ctx: CanvasRenderingContext2D,
  lm: LM[],
  cW: number, cH: number,
  skinTone?: string, hairCol?: string, eyeCol?: string,
  mirrored = true,
) {
  const pt    = (i: number) => lmToCanvas(lm[i].x, lm[i].y, cW, cH, mirrored);
  const path  = (ids: number[], close = true) => {
    ctx.beginPath();
    ids.forEach((id, j) => { const p = pt(id); j === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y); });
    if (close) ctx.closePath();
  };

  const skin = getSkin(skinTone);
  const hair = getHair(hairCol);
  const eye  = getEye(eyeCol);
  const lip  = getLip(skinTone);

  // Key reference geometry
  const top    = pt(10);
  const foreL  = pt(109);
  const foreR  = pt(338);
  const chin   = pt(152);
  const lJaw   = pt(127);
  const rJaw   = pt(356);
  const faceW  = Math.abs(rJaw.x - lJaw.x);
  const faceH  = Math.abs(chin.y - top.y);

  // ════════════════════════════════════════════════════════════════
  //  LAYER 0 — EARS (behind face)
  // ════════════════════════════════════════════════════════════════
  const lEar   = pt(234);
  const rEar   = pt(454);
  const earH   = faceW * 0.15;
  const earW   = earH * 0.52;
  ctx.save();
  ctx.fillStyle   = skin.base;
  ctx.strokeStyle = skin.shadow;
  ctx.lineWidth   = 1;
  ctx.beginPath(); ctx.ellipse(lEar.x - earW * 0.4, lEar.y, earW, earH, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.ellipse(rEar.x + earW * 0.4, rEar.y, earW, earH, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.restore();

  // ════════════════════════════════════════════════════════════════
  //  LAYER 1 — HAIR (tight cap, bezier arch)
  // ════════════════════════════════════════════════════════════════
  const capH = faceW * 0.18;
  ctx.save();
  ctx.fillStyle = hair;
  ctx.beginPath();
  ctx.moveTo(foreL.x - faceW * 0.04, foreL.y + faceW * 0.01);
  ctx.bezierCurveTo(
    foreL.x - faceW * 0.06, top.y - capH,
    foreR.x + faceW * 0.06, top.y - capH,
    foreR.x + faceW * 0.04, foreR.y + faceW * 0.01,
  );
  ctx.lineTo(foreR.x, foreR.y);
  ctx.lineTo(top.x, top.y);
  ctx.lineTo(foreL.x, foreL.y);
  ctx.closePath();
  ctx.fill();
  // Hair sheen
  const hg = ctx.createLinearGradient(top.x - faceW * 0.15, top.y - capH, top.x + faceW * 0.15, top.y);
  hg.addColorStop(0, "rgba(255,255,255,0.13)");
  hg.addColorStop(0.5, "rgba(255,255,255,0)");
  ctx.fillStyle = hg;
  ctx.fill();
  ctx.restore();

  // ════════════════════════════════════════════════════════════════
  //  LAYER 2 — FACE BASE SKIN
  // ════════════════════════════════════════════════════════════════
  path(FACE_OVAL);
  ctx.save();
  ctx.globalAlpha = 0.88; // semi-transparent — real face bleeds through
  ctx.fillStyle   = skin.base;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.restore();

  // ── Multi-layer gradient contouring ──────────────────────────
  // Forehead highlight
  const fg = ctx.createRadialGradient(top.x, foreL.y + faceH * 0.08, 0, top.x, foreL.y, faceW * 0.38);
  fg.addColorStop(0,    "rgba(255,245,225,0.28)");
  fg.addColorStop(0.6,  "rgba(255,245,225,0)");
  path(FACE_OVAL); ctx.fillStyle = fg; ctx.fill();

  // Temple & jaw shadow (gives 3D structure)
  const tsg = ctx.createLinearGradient(lJaw.x, lJaw.y, rJaw.x, rJaw.y);
  tsg.addColorStop(0,    `rgba(0,0,0,0.22)`);
  tsg.addColorStop(0.18, "rgba(0,0,0,0)");
  tsg.addColorStop(0.82, "rgba(0,0,0,0)");
  tsg.addColorStop(1,    `rgba(0,0,0,0.22)`);
  path(FACE_OVAL); ctx.fillStyle = tsg; ctx.fill();

  // Top-to-chin shading (darkens chin)
  const cg = ctx.createLinearGradient(top.x, top.y, top.x, chin.y);
  cg.addColorStop(0,   "rgba(255,235,205,0.10)");
  cg.addColorStop(0.5, "rgba(0,0,0,0)");
  cg.addColorStop(1,   "rgba(0,0,0,0.20)");
  path(FACE_OVAL); ctx.fillStyle = cg; ctx.fill();

  // Cheekbone specular highlights
  [pt(50), pt(280)].forEach((c, i) => {
    const cx = c.x + (i === 0 ? faceW * 0.04 : -faceW * 0.04);
    const cy = c.y - faceW * 0.02;
    const cg2 = ctx.createRadialGradient(cx, cy, 0, cx, cy, faceW * 0.10);
    cg2.addColorStop(0, "rgba(255,245,225,0.20)");
    cg2.addColorStop(1, "rgba(255,245,225,0)");
    ctx.beginPath(); ctx.arc(cx, cy, faceW * 0.10, 0, Math.PI * 2);
    ctx.fillStyle = cg2; ctx.fill();
  });

  // ════════════════════════════════════════════════════════════════
  //  LAYER 3 — EYEBROWS (modern tapered bezier arch)
  // ════════════════════════════════════════════════════════════════
  const browColor = hair === "#D0C8B8" ? "#807050" : hair;
  const drawBrow  = (outer: number, peak: number, inner: number, side: "L" | "R") => {
    const o = pt(outer), p2 = pt(peak), inn = pt(inner);
    const thickness = faceW * 0.013;
    // Draw brow as a filled tapered shape
    ctx.save();
    ctx.fillStyle = browColor;

    // offset vectors for thickness
    const dx = p2.x - o.x, dy = p2.y - o.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len * thickness, ny = dx / len * thickness;

    ctx.beginPath();
    // bottom edge (outer → inner)
    ctx.moveTo(o.x, o.y);
    ctx.bezierCurveTo(
      o.x + (p2.x - o.x) * 0.3, o.y + (p2.y - o.y) * 0.3,
      p2.x + (inn.x - p2.x) * 0.3, p2.y + (inn.y - p2.y) * 0.3,
      inn.x, inn.y,
    );
    // top edge (inner → outer) — offset upward by thickness
    ctx.lineTo(inn.x - nx * 0.4, inn.y - ny * 0.4);
    ctx.bezierCurveTo(
      p2.x + (inn.x - p2.x) * 0.3 - nx * 0.8, p2.y + (inn.y - p2.y) * 0.3 - ny * 0.8,
      o.x + (p2.x - o.x) * 0.3 - nx, o.y + (p2.y - o.y) * 0.3 - ny,
      o.x - nx * 0.5, o.y - ny * 0.5,
    );
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  };
  // Brow landmark indices: outer, peak, inner for each side
  drawBrow(46, 52, 55, "L");
  drawBrow(276, 282, 285, "R");

  // ════════════════════════════════════════════════════════════════
  //  LAYER 4 — EYES (modern detailed)
  // ════════════════════════════════════════════════════════════════
  const drawEye = (eyeIds: number[], upperIds: number[]) => {
    const pts  = eyeIds.map(i => pt(i));
    const xs   = pts.map(p => p.x), ys = pts.map(p => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const cx   = (minX + maxX) / 2;
    const cy   = (minY + maxY) / 2;
    const ew   = maxX - minX;
    const eh   = maxY - minY;
    const irisR = Math.max(eh * 0.54, 3);

    ctx.save();
    path(eyeIds);
    ctx.clip();

    // Sclera — warm white with subtle limbal shadow
    const scleraG = ctx.createRadialGradient(cx, cy, 0, cx, cy, ew * 0.55);
    scleraG.addColorStop(0,   "#F5EDE4");
    scleraG.addColorStop(0.7, "#EDE0D4");
    scleraG.addColorStop(1,   "#D4C0A8");
    ctx.fillStyle = scleraG;
    ctx.fillRect(minX - 2, minY - 2, ew + 4, eh + 4);

    // Iris — multi-stop radial gradient for depth
    const iG = ctx.createRadialGradient(cx - irisR * 0.1, cy - irisR * 0.12, 0, cx, cy, irisR);
    iG.addColorStop(0,    lighten(eye, 40));
    iG.addColorStop(0.35, eye);
    iG.addColorStop(0.75, eye);
    iG.addColorStop(0.88, darken(eye, 30));
    iG.addColorStop(1,    "#0A0A0A");
    ctx.beginPath(); ctx.arc(cx, cy, irisR, 0, Math.PI * 2);
    ctx.fillStyle = iG; ctx.fill();

    // Iris texture (radial lines for depth)
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, irisR, 0, Math.PI * 2); ctx.clip();
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 14) {
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * irisR * 0.25, cy + Math.sin(a) * irisR * 0.25);
      ctx.lineTo(cx + Math.cos(a) * irisR * 0.92, cy + Math.sin(a) * irisR * 0.92);
      ctx.strokeStyle = "rgba(0,0,0,0.08)";
      ctx.lineWidth   = 0.8;
      ctx.stroke();
    }
    ctx.restore();

    // Pupil — soft edge
    const pG = ctx.createRadialGradient(cx, cy, 0, cx, cy, irisR * 0.44);
    pG.addColorStop(0.6, "#060606");
    pG.addColorStop(1,   "rgba(6,6,6,0)");
    ctx.beginPath(); ctx.arc(cx, cy, irisR * 0.44, 0, Math.PI * 2);
    ctx.fillStyle = pG; ctx.fill();

    // Main catchlight
    const cl = ctx.createRadialGradient(
      cx + irisR * 0.28, cy - irisR * 0.30, 0,
      cx + irisR * 0.28, cy - irisR * 0.30, irisR * 0.20,
    );
    cl.addColorStop(0, "rgba(255,255,255,0.95)");
    cl.addColorStop(1, "rgba(255,255,255,0)");
    ctx.beginPath(); ctx.arc(cx + irisR * 0.28, cy - irisR * 0.30, irisR * 0.20, 0, Math.PI * 2);
    ctx.fillStyle = cl; ctx.fill();
    // Secondary small catchlight
    ctx.beginPath(); ctx.arc(cx - irisR * 0.18, cy + irisR * 0.24, irisR * 0.08, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.45)"; ctx.fill();

    // Upper lid shade — gives eyelid depth
    const ulg = ctx.createLinearGradient(cx, minY, cx, cy);
    ulg.addColorStop(0, "rgba(0,0,0,0.32)");
    ulg.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = ulg;
    ctx.fillRect(minX - 2, minY, ew + 4, (eh) * 0.6);

    ctx.restore();

    // Lash line — dark, smooth outline
    ctx.save();
    path(eyeIds);
    ctx.strokeStyle = "rgba(10,10,10,0.90)";
    ctx.lineWidth   = 1.8;
    ctx.lineJoin    = "round";
    ctx.stroke();
    ctx.restore();

    // Fan lashes (top only) — draw radial lines from upper lid
    ctx.save();
    const upperPts = upperIds.map(i => pt(i));
    ctx.strokeStyle = "rgba(10,10,10,0.80)";
    ctx.lineCap     = "round";
    upperPts.forEach((p) => {
      const dx = p.x - cx, dy = p.y - cy;
      const len = Math.hypot(dx, dy) || 1;
      const lashLen = eh * 0.55;
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x + dx / len * lashLen, p.y + dy / len * lashLen);
      ctx.stroke();
    });
    ctx.restore();
  };

  drawEye(LEFT_EYE, LEFT_EYE_UPPER);
  drawEye(RIGHT_EYE, RIGHT_EYE_UPPER);

  // ════════════════════════════════════════════════════════════════
  //  LAYER 5 — NOSE (subtle, modern)
  // ════════════════════════════════════════════════════════════════
  const nBridge = pt(6);
  const nTip    = pt(4);
  const nL      = pt(239);
  const nR      = pt(459);
  const nW      = Math.abs(nR.x - nL.x);

  ctx.save();
  ctx.lineCap = "round";

  // Bridge shadow lines (very subtle)
  ctx.globalAlpha = 0.22;
  ctx.strokeStyle = skin.deep;
  ctx.lineWidth   = Math.max(nW * 0.055, 1);
  ctx.beginPath();
  ctx.moveTo(nBridge.x - nW * 0.08, nBridge.y);
  ctx.quadraticCurveTo(nTip.x - nW * 0.20, nTip.y - nW * 0.14, nTip.x - nW * 0.10, nTip.y);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(nBridge.x + nW * 0.08, nBridge.y);
  ctx.quadraticCurveTo(nTip.x + nW * 0.20, nTip.y - nW * 0.14, nTip.x + nW * 0.10, nTip.y);
  ctx.stroke();

  // Alar shadows (nostrils)
  ctx.globalAlpha = 0.38;
  ctx.fillStyle   = skin.deep;
  ctx.beginPath(); ctx.ellipse(nL.x - nW * 0.02, nL.y + nW * 0.05, nW * 0.16, nW * 0.11, -0.3, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(nR.x + nW * 0.02, nR.y + nW * 0.05, nW * 0.16, nW * 0.11,  0.3, 0, Math.PI * 2); ctx.fill();

  // Nose tip highlight
  ctx.globalAlpha = 0.26;
  ctx.fillStyle   = skin.hi;
  ctx.beginPath(); ctx.ellipse(nTip.x, nTip.y - nW * 0.04, nW * 0.11, nW * 0.08, 0, 0, Math.PI * 2); ctx.fill();

  ctx.restore();

  // ════════════════════════════════════════════════════════════════
  //  LAYER 6 — LIPS (modern glossy)
  // ════════════════════════════════════════════════════════════════
  // Base fill
  path(LIPS_OUT);
  ctx.fillStyle = lip.fill;
  ctx.fill();

  // Inner mouth
  path(LIPS_IN);
  ctx.fillStyle = "rgba(20,8,8,0.72)";
  ctx.fill();

  // Upper lip gradient (darker at seam, lighter toward center)
  const lCornerL = pt(61);
  const lCornerR = pt(291);
  const lipMidX  = (lCornerL.x + lCornerR.x) / 2;
  const lipTopY  = pt(0).y;
  const lipBotY  = pt(17).y;

  ctx.save();
  const ulg2 = ctx.createLinearGradient(lipMidX, lipTopY - 2, lipMidX, lipBotY);
  ulg2.addColorStop(0,    lip.hi);
  ulg2.addColorStop(0.45, "rgba(255,200,180,0)");
  path(LIPS_OUT.slice(0, 11));
  ctx.fillStyle = ulg2; ctx.fill();
  ctx.restore();

  // Lower lip gloss dome
  ctx.save();
  const lm17  = pt(17);
  const lipW  = Math.abs(lCornerR.x - lCornerL.x);
  const llg2  = ctx.createRadialGradient(lm17.x, lm17.y - lipW * 0.01, 0, lm17.x, lm17.y, lipW * 0.22);
  llg2.addColorStop(0, "rgba(255,220,200,0.52)");
  llg2.addColorStop(1, "rgba(255,220,200,0)");
  ctx.beginPath(); ctx.ellipse(lm17.x, lm17.y - lipW * 0.01, lipW * 0.22, lipW * 0.055, 0, 0, Math.PI * 2);
  ctx.fillStyle = llg2; ctx.fill();
  ctx.restore();

  // Lip outline — thin dark seam
  path(LIPS_OUT);
  ctx.strokeStyle = lip.mid;
  ctx.lineWidth   = 0.7;
  ctx.stroke();

  // ════════════════════════════════════════════════════════════════
  //  LAYER 7 — FINISHING TOUCHES
  // ════════════════════════════════════════════════════════════════

  // Subtle center-face highlight (nose bridge, philtrum, chin)
  const ctrG = ctx.createLinearGradient(top.x, pt(6).y, top.x, chin.y);
  ctrG.addColorStop(0,    "rgba(255,248,235,0.12)");
  ctrG.addColorStop(0.4,  "rgba(255,248,235,0.06)");
  ctrG.addColorStop(1,    "rgba(255,248,235,0.08)");
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(top.x, (top.y + chin.y) * 0.5, faceW * 0.16, faceH * 0.52, 0, 0, Math.PI * 2);
  ctx.fillStyle = ctrG; ctx.fill();
  ctx.restore();

  // Under-eye shadow (natural aging / depth)
  [pt(110), pt(339)].forEach(c => {
    const ucg = ctx.createRadialGradient(c.x, c.y + faceW * 0.01, 0, c.x, c.y + faceW * 0.01, faceW * 0.07);
    ucg.addColorStop(0, "rgba(80,40,20,0.12)");
    ucg.addColorStop(1, "rgba(80,40,20,0)");
    ctx.beginPath(); ctx.arc(c.x, c.y + faceW * 0.01, faceW * 0.07, 0, Math.PI * 2);
    ctx.fillStyle = ucg; ctx.fill();
  });
}

// ─── Color utility helpers ────────────────────────────────────────────────────
function lighten(hex: string, amt: number): string {
  const r = Math.min(255, parseInt(hex.slice(1,3), 16) + amt);
  const g = Math.min(255, parseInt(hex.slice(3,5), 16) + amt);
  const b = Math.min(255, parseInt(hex.slice(5,7), 16) + amt);
  return `rgb(${r},${g},${b})`;
}
function darken(hex: string, amt: number): string {
  const r = Math.max(0, parseInt(hex.slice(1,3), 16) - amt);
  const g = Math.max(0, parseInt(hex.slice(3,5), 16) - amt);
  const b = Math.max(0, parseInt(hex.slice(5,7), 16) - amt);
  return `rgb(${r},${g},${b})`;
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

  const streamRef        = useRef<MediaStream | null>(null);
  const sourceCanvasRef  = useRef<HTMLCanvasElement>(null);
  const outputCanvasRef  = useRef<HTMLCanvasElement>(null);
  const outputVideoRef   = useRef<HTMLVideoElement>(null);
  const mediapipeInitRef = useRef(false);
  const avatarRef        = useRef(activeAvatar);
  useEffect(() => { avatarRef.current = activeAvatar; }, [activeAvatar]);

  // Wire output video to stream
  useEffect(() => {
    if (hasPermission && streamRef.current && outputVideoRef.current) {
      outputVideoRef.current.srcObject = streamRef.current;
      outputVideoRef.current.play().catch(() => {});
    }
  }, [hasPermission]);

  // Keep canvas pixel sizes in sync with CSS layout (CSS pixels, no DPR scaling to avoid offset bugs)
  useEffect(() => {
    if (hasPermission !== true) return;
    const sync = (el: HTMLCanvasElement | null) => {
      if (!el) return () => {};
      const resize = () => {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && (el.width !== Math.round(r.width) || el.height !== Math.round(r.height))) {
          el.width  = Math.round(r.width);
          el.height = Math.round(r.height);
        }
      };
      const ro = new ResizeObserver(resize);
      ro.observe(el);
      requestAnimationFrame(resize);
      return () => ro.disconnect();
    };
    const c1 = sync(sourceCanvasRef.current);
    const c2 = sync(outputCanvasRef.current);
    return () => { c1(); c2(); };
  }, [hasPermission]);

  const requestPermissions = async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      streamRef.current = s;
      setHasPermission(true);
    } catch { setHasPermission(false); }
  };

  const initAudio = useCallback((stream: MediaStream) => {
    const ctx = new AudioContext();
    const an  = ctx.createAnalyser();
    ctx.createMediaStreamSource(stream).connect(an);
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
    if (mediapipeInitRef.current) return;
    mediapipeInitRef.current = true;
    video.srcObject = stream;
    video.play().catch(() => {});

    const fm = new FaceMesh({
      locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4/${f}`,
    });
    fm.setOptions({ maxNumFaces: 1, refineLandmarks: false, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });

    fm.onResults((res) => {
      const detected = !!(res.multiFaceLandmarks?.length);
      setFaceDetected(detected);

      // Source panel — cyan dots (no mirror)
      const sc   = sourceCanvasRef.current;
      const sCtx = sc?.getContext("2d");
      if (sCtx && sc) {
        sCtx.clearRect(0, 0, sc.width, sc.height);
        if (detected) {
          sCtx.fillStyle = "rgba(0,255,190,0.72)";
          for (const p of res.multiFaceLandmarks[0]) {
            const { x, y } = lmToCanvas(p.x, p.y, sc.width, sc.height, false);
            sCtx.beginPath(); sCtx.arc(x, y, 1.4, 0, Math.PI * 2); sCtx.fill();
          }
        }
      }

      // Output panel — modern face (mirrored to match video)
      const oc   = outputCanvasRef.current;
      const oCtx = oc?.getContext("2d");
      if (oCtx && oc) {
        oCtx.clearRect(0, 0, oc.width, oc.height);
        if (detected) {
          const av = avatarRef.current;
          drawModernFace(oCtx, res.multiFaceLandmarks[0] as LM[], oc.width, oc.height,
            av?.skinTone, av?.hairColor, av?.eyeColor, true);
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
    const stream  = streamRef.current;
    const cleanup = initAudio(stream);
    const t       = setTimeout(() => initMediaPipe(stream, videoEl), 120);
    return () => { clearTimeout(t); cleanup?.(); };
  }, [hasPermission, videoEl, initAudio, initMediaPipe]);

  useEffect(() => {
    let iv: ReturnType<typeof setInterval>;
    if (isStreaming) {
      iv = setInterval(() => { setElapsed(e => e + 1); setFps(Math.floor(Math.random() * 5 + 55)); }, 1000);
    } else { setElapsed(0); setFps(0); }
    return () => clearInterval(iv);
  }, [isStreaming]);

  const fmt = (s: number) =>
    `${Math.floor(s / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;

  // ── Permission screens ────────────────────────────────────────────────────────
  if (hasPermission === false) {
    return (
      <Layout>
        <div className="flex-1 flex items-center justify-center">
          <div className="max-w-md text-center space-y-6 p-8 border border-destructive/20 bg-destructive/5 rounded-lg">
            <Video className="w-12 h-12 text-destructive mx-auto" />
            <h2 className="text-xl font-bold text-destructive">Accès caméra refusé</h2>
            <p className="text-muted-foreground">Autorisez la caméra et le micro dans votre navigateur.</p>
            <Button onClick={() => { mediapipeInitRef.current = false; requestPermissions(); }} className="w-full">Réessayer</Button>
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

  // ── Main studio ───────────────────────────────────────────────────────────────
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
                className="absolute inset-0 w-full h-full object-cover opacity-50"
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

          {/* RIGHT — modern face avatar */}
          <div className="flex-1 relative rounded-lg overflow-hidden border border-border bg-black min-h-0">
            <video
              ref={outputVideoRef}
              autoPlay playsInline muted
              className="absolute inset-0 w-full h-full object-cover"
              style={{ transform: "scaleX(-1)" }}
            />
            <canvas ref={outputCanvasRef} className="absolute inset-0 w-full h-full" />

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
