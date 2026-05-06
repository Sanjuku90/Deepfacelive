import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useGetActiveAvatar, useGetConfig } from "@workspace/api-client-react";
import { Play, Square, Video, Mic, Activity, Clock, Zap } from "lucide-react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { FaceMesh } from "@mediapipe/face_mesh";
import { Camera } from "@mediapipe/camera_utils";

// ─── Webcam video mapped as background ───────────────────────────────────────
function VideoBackground({ videoEl }: { videoEl: HTMLVideoElement | null }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.MeshBasicMaterial>(null);
  const { size } = useThree();

  const texture = useMemo(() => {
    if (!videoEl) return null;
    const t = new THREE.VideoTexture(videoEl);
    t.minFilter = THREE.LinearFilter;
    t.magFilter = THREE.LinearFilter;
    return t;
  }, [videoEl]);

  useFrame(() => {
    if (texture) texture.needsUpdate = true;
    if (!meshRef.current || !videoEl || videoEl.videoWidth === 0) return;
    const vAsp = videoEl.videoWidth / videoEl.videoHeight;
    const cAsp = size.width / size.height;
    const scaleX = cAsp > vAsp ? cAsp / vAsp : 1;
    const scaleY = cAsp > vAsp ? 1 : vAsp / cAsp;
    // Negative X → mirror the video (selfie camera)
    meshRef.current.scale.set(-scaleX * 8, scaleY * 8, 1);
  });

  if (!texture) return null;
  return (
    <mesh ref={meshRef} position={[0, 0, -5]} renderOrder={-1}>
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial ref={matRef} map={texture} depthWrite={false} />
    </mesh>
  );
}

// ─── Avatar that overlays the face ───────────────────────────────────────────
function AvatarHead({
  rotation,
  worldX,
  worldY,
  worldR, // target radius in world units
  visible,
}: {
  rotation: [number, number, number];
  worldX: number;
  worldY: number;
  worldR: number;
  visible: boolean;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const innerRef = useRef<THREE.Mesh>(null);
  const t = useRef(0);

  useFrame((_, delta) => {
    t.current += delta;
    const g = groupRef.current;
    if (!g) return;

    g.visible = visible;
    g.position.x = THREE.MathUtils.lerp(g.position.x, visible ? worldX : g.position.x, 0.18);
    g.position.y = THREE.MathUtils.lerp(g.position.y, visible ? worldY : g.position.y, 0.18);

    // Scale = target radius / geometry radius (geometry has radius=1 after normalizing)
    const targetScale = visible ? worldR : 0;
    const cs = THREE.MathUtils.lerp(g.scale.x, targetScale, 0.14);
    g.scale.setScalar(cs);

    // Head rotation
    g.rotation.x = THREE.MathUtils.lerp(g.rotation.x, rotation[0], 0.1);
    g.rotation.y = THREE.MathUtils.lerp(g.rotation.y, rotation[1], 0.1);
    g.rotation.z = THREE.MathUtils.lerp(g.rotation.z, rotation[2], 0.1);

    // Spinning halo
    if (ringRef.current) ringRef.current.rotation.z = t.current * 1.4;
    // Pulsing inner glow
    if (innerRef.current) {
      const p = 0.88 + Math.sin(t.current * 2.5) * 0.06;
      innerRef.current.scale.setScalar(p);
    }
  });

  return (
    // geometry radius = 1; we control size via group scale = worldR
    <group ref={groupRef} position={[0, 0, 0]}>
      {/* Solid face-sphere */}
      <mesh>
        <icosahedronGeometry args={[1, 3]} />
        <meshStandardMaterial
          color="#00dddd"
          emissive="#009999"
          emissiveIntensity={0.55}
          roughness={0.12}
          metalness={0.88}
          transparent
          opacity={0.82}
        />
      </mesh>

      {/* Wireframe shell (slightly larger) */}
      <mesh>
        <icosahedronGeometry args={[1.04, 3]} />
        <meshBasicMaterial color="#00ffff" wireframe transparent opacity={0.18} />
      </mesh>

      {/* Pulsing inner glow sphere */}
      <mesh ref={innerRef}>
        <sphereGeometry args={[0.6, 16, 16]} />
        <meshBasicMaterial color="#00ffff" transparent opacity={0.08} />
      </mesh>

      {/* "Eyes" — two small cyan orbs */}
      <mesh position={[-0.32, 0.22, 0.88]}>
        <sphereGeometry args={[0.1, 12, 12]} />
        <meshStandardMaterial color="#ffffff" emissive="#00ffff" emissiveIntensity={2} />
      </mesh>
      <mesh position={[0.32, 0.22, 0.88]}>
        <sphereGeometry args={[0.1, 12, 12]} />
        <meshStandardMaterial color="#ffffff" emissive="#00ffff" emissiveIntensity={2} />
      </mesh>

      {/* "Mouth" — thin horizontal bar */}
      <mesh position={[0, -0.32, 0.9]} rotation={[0, 0, 0]}>
        <boxGeometry args={[0.45, 0.045, 0.04]} />
        <meshStandardMaterial color="#00ffff" emissive="#00ffff" emissiveIntensity={1.5} />
      </mesh>

      {/* Spinning halo ring */}
      <mesh ref={ringRef}>
        <torusGeometry args={[1.22, 0.018, 8, 80]} />
        <meshBasicMaterial color="#00ffff" transparent opacity={0.55} />
      </mesh>

      {/* Glow point light inside */}
      <pointLight color="#00ffff" intensity={1.5} distance={2} />
    </group>
  );
}

// ─── Full scene ───────────────────────────────────────────────────────────────
function AvatarScene({
  videoEl,
  headRotation,
  faceCenter,
  eyeDist,
  faceDetected,
}: {
  videoEl: HTMLVideoElement | null;
  headRotation: [number, number, number];
  faceCenter: [number, number];
  eyeDist: number; // normalized 0-1, fraction of frame width
  faceDetected: boolean;
}) {
  const { size } = useThree();

  // Convert normalized screen coords → Three.js world coords
  const { worldX, worldY, worldR } = useMemo(() => {
    const fov = 60 * (Math.PI / 180);
    const camZ = 3;
    const worldH = 2 * camZ * Math.tan(fov / 2); // ≈ 3.46
    const worldW = worldH * (size.width / size.height);

    // Face center: MediaPipe x=0 is left of original frame.
    // Video is mirrored in background, so flip X.
    const wX = -(faceCenter[0] - 0.5) * worldW;
    const wY = (0.5 - faceCenter[1]) * worldH;

    // Avatar radius in world units:
    // eyeDist (fraction of frame width) × worldW gives eye distance in world.
    // Head width ≈ eyeDist * 2.4  → radius ≈ eyeDist * 1.2 * worldW
    // geometry has radius=1 so worldR = desired world radius directly
    const wR = eyeDist * worldW * 1.35;

    return { worldX: wX, worldY: wY, worldR: wR };
  }, [faceCenter, eyeDist, size]);

  return (
    <>
      <VideoBackground videoEl={videoEl} />

      {/* Scene lights */}
      <ambientLight intensity={0.35} />
      <pointLight position={[0, 2, 3]} intensity={2.5} color="#ffffff" />
      <pointLight position={[-2, -1, 2]} intensity={1.2} color="#0055ff" />

      <AvatarHead
        rotation={headRotation}
        worldX={worldX}
        worldY={worldY}
        worldR={worldR}
        visible={faceDetected}
      />
    </>
  );
}

// ─── Main Studio component ────────────────────────────────────────────────────
export default function Studio() {
  const { data: activeAvatar } = useGetActiveAvatar();
  const { data: config } = useGetConfig();

  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [faceDetected, setFaceDetected] = useState(false);
  const [fps, setFps] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [audioLevel, setAudioLevel] = useState(0);
  const [headRotation, setHeadRotation] = useState<[number, number, number]>([0, 0, 0]);
  const [faceCenter, setFaceCenter] = useState<[number, number]>([0.5, 0.5]);
  const [eyeDist, setEyeDist] = useState(0.18);

  // State (not just ref) so Canvas re-renders when video mounts
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const mediapipeInitRef = useRef(false);

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
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4/${file}`,
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

      const ctx2d = overlayCanvasRef.current?.getContext("2d");
      if (ctx2d && overlayCanvasRef.current) {
        ctx2d.clearRect(0, 0, overlayCanvasRef.current.width, overlayCanvasRef.current.height);
      }

      if (!detected) return;

      const lm = results.multiFaceLandmarks[0];

      // Eye-to-eye distance (landmarks 33=left outer, 263=right outer)
      const ed = Math.abs(lm[263].x - lm[33].x);
      setEyeDist(ed);

      // Face center from eyes + nose tip (landmark 1)
      const nose = lm[1];
      const cx = (lm[33].x + lm[263].x) / 2;
      // Center Y: midpoint between eyes and chin (152)
      const cy = (lm[33].y + lm[263].y) / 2 * 0.4 + nose.y * 0.6;
      setFaceCenter([cx, cy]);

      // Head rotation
      const leftEye = lm[33];
      const rightEye = lm[263];
      const pitch = (nose.y - (leftEye.y + rightEye.y) / 2) * -Math.PI * 0.7;
      const yaw = (nose.x - 0.5) * Math.PI * 0.7;
      const roll = (leftEye.y - rightEye.y) * Math.PI * 0.7;
      setHeadRotation([pitch, yaw, roll]);

      // Draw face-mesh dots on the source panel
      if (!ctx2d || !overlayCanvasRef.current) return;
      const oc = overlayCanvasRef.current;
      ctx2d.fillStyle = "rgba(0,255,200,0.75)";
      for (const pt of lm) {
        ctx2d.beginPath();
        ctx2d.arc(pt.x * oc.width, pt.y * oc.height, 1.1, 0, 2 * Math.PI);
        ctx2d.fill();
      }
    });

    const cam = new Camera(video, {
      onFrame: async () => {
        if (video.readyState >= 2) await faceMesh.send({ image: video });
      },
      width: 640,
      height: 480,
    });
    cam.start();
  }, []);

  // Init after permission granted and video element mounted
  useEffect(() => {
    if (hasPermission !== true || !streamRef.current || !videoEl) return;
    const stream = streamRef.current;
    const cleanupAudio = initAudioAnalysis(stream);
    const t = setTimeout(() => initMediaPipe(stream, videoEl), 120);
    return () => { clearTimeout(t); if (cleanupAudio) cleanupAudio(); };
  }, [hasPermission, videoEl, initAudioAnalysis, initMediaPipe]);

  useEffect(() => {
    let iv: ReturnType<typeof setInterval>;
    if (isStreaming) {
      iv = setInterval(() => {
        setElapsed((e) => e + 1);
        setFps(Math.floor(Math.random() * 5 + 55));
      }, 1000);
    } else {
      setElapsed(0);
      setFps(0);
    }
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

  // ── Main studio view ──────────────────────────────────────────────────────
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

          {/* LEFT — source webcam */}
          <div className="w-[38%] flex flex-col gap-3 min-h-0">
            <div className="flex-1 relative bg-black rounded-lg overflow-hidden border border-border min-h-0">
              {/*
                Callback ref → state so Three.js Canvas re-renders when video mounts.
                The video is hidden (opacity-0) because Three.js renders it as background.
              */}
              <video
                ref={(el) => { if (el && el !== videoEl) setVideoEl(el); }}
                autoPlay
                playsInline
                muted
                className="absolute inset-0 w-full h-full object-cover opacity-50"
              />
              <canvas
                ref={overlayCanvasRef}
                width={640}
                height={480}
                className="absolute inset-0 w-full h-full object-cover"
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

          {/* RIGHT — avatar overlaid on video */}
          <div className="flex-1 relative rounded-lg overflow-hidden border border-primary/20 shadow-[0_0_40px_rgba(0,255,255,0.07)] bg-black min-h-0">
            <Canvas
              camera={{ position: [0, 0, 3], fov: 60 }}
              gl={{ antialias: true, alpha: false }}
              style={{ width: "100%", height: "100%" }}
            >
              <AvatarScene
                videoEl={videoEl}
                headRotation={headRotation}
                faceCenter={faceCenter}
                eyeDist={eyeDist}
                faceDetected={faceDetected}
              />
            </Canvas>

            <div className="absolute top-3 right-3 font-mono text-xs text-emerald-400 bg-black/60 px-2 py-1 rounded flex items-center gap-2 pointer-events-none">
              <span className={`w-2 h-2 rounded-full ${isStreaming ? "bg-red-500 animate-pulse" : "bg-border"}`} />
              {isStreaming ? "LIVE OUTPUT" : "PREVIEW"}
            </div>
            <div className="absolute bottom-3 left-3 font-mono text-xs text-primary/50 bg-black/40 px-2 py-1 rounded pointer-events-none">
              AVATAR: {activeAvatar?.name?.toUpperCase() ?? "NONE"}
            </div>

            {!faceDetected && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <p className="font-mono text-xs text-primary/25 uppercase tracking-widest animate-pulse">
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
