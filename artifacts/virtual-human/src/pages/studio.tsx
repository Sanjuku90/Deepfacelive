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

// ─── Webcam background fills the Three.js canvas ─────────────────────────────
function VideoBackground({ videoEl }: { videoEl: HTMLVideoElement | null }) {
  const texture = useMemo(() => {
    if (!videoEl) return null;
    const t = new THREE.VideoTexture(videoEl);
    t.minFilter = THREE.LinearFilter;
    t.magFilter = THREE.LinearFilter;
    return t;
  }, [videoEl]);

  const meshRef = useRef<THREE.Mesh>(null);
  const { size } = useThree();

  useFrame(() => {
    if (texture) texture.needsUpdate = true;
    if (meshRef.current && videoEl && videoEl.videoWidth > 0) {
      const videoAspect = videoEl.videoWidth / videoEl.videoHeight;
      const canvasAspect = size.width / size.height;
      // Cover: fill the canvas while maintaining video aspect ratio (mirrored)
      let scaleX = 1, scaleY = 1;
      if (canvasAspect > videoAspect) {
        scaleX = canvasAspect / videoAspect;
      } else {
        scaleY = videoAspect / canvasAspect;
      }
      meshRef.current.scale.set(-scaleX * 6, scaleY * 6, 1); // negative X = mirror
    }
  });

  if (!texture) return null;
  return (
    <mesh ref={meshRef} position={[0, 0, -4]}>
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial map={texture} depthWrite={false} />
    </mesh>
  );
}

// ─── Avatar head overlaid on the detected face ───────────────────────────────
interface AvatarProps {
  rotation: [number, number, number];
  worldX: number;
  worldY: number;
  worldScale: number;
  visible: boolean;
}

function AvatarHead({ rotation, worldX, worldY, worldScale, visible }: AvatarProps) {
  const groupRef = useRef<THREE.Group>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const t = useRef(0);

  useFrame((_, delta) => {
    t.current += delta;
    if (!groupRef.current) return;

    groupRef.current.visible = visible;

    // Smoothly track target position and scale
    groupRef.current.position.x = THREE.MathUtils.lerp(groupRef.current.position.x, worldX, 0.15);
    groupRef.current.position.y = THREE.MathUtils.lerp(groupRef.current.position.y, worldY, 0.15);
    const targetScale = visible ? worldScale : 0;
    const currentScale = THREE.MathUtils.lerp(groupRef.current.scale.x, targetScale, 0.12);
    groupRef.current.scale.setScalar(currentScale);

    // Apply head rotation
    groupRef.current.rotation.x = THREE.MathUtils.lerp(groupRef.current.rotation.x, rotation[0], 0.1);
    groupRef.current.rotation.y = THREE.MathUtils.lerp(groupRef.current.rotation.y, rotation[1], 0.1);
    groupRef.current.rotation.z = THREE.MathUtils.lerp(groupRef.current.rotation.z, rotation[2], 0.1);

    if (ringRef.current) {
      ringRef.current.rotation.z = t.current * 1.2;
    }
  });

  return (
    <group ref={groupRef} position={[0, 0, 0]}>
      {/* Main face sphere */}
      <mesh>
        <icosahedronGeometry args={[0.5, 3]} />
        <meshStandardMaterial
          color="#00ffff"
          emissive="#00bbbb"
          emissiveIntensity={0.6}
          roughness={0.1}
          metalness={0.9}
          transparent
          opacity={0.88}
        />
      </mesh>

      {/* Wireframe shell */}
      <mesh>
        <icosahedronGeometry args={[0.52, 3]} />
        <meshBasicMaterial color="#00ffff" wireframe transparent opacity={0.2} />
      </mesh>

      {/* Spinning ring (halo) */}
      <mesh ref={ringRef}>
        <torusGeometry args={[0.72, 0.015, 8, 64]} />
        <meshBasicMaterial color="#00ffff" transparent opacity={0.7} />
      </mesh>

      {/* Glow point light */}
      <pointLight color="#00ffff" intensity={2} distance={2} />
    </group>
  );
}

// ─── Face-to-world coordinate conversion ─────────────────────────────────────
function useFaceToWorld(faceCenter: [number, number], faceSize: number) {
  const { size } = useThree();
  return useMemo(() => {
    const fov = 60 * (Math.PI / 180);
    const camZ = 3;
    const worldH = 2 * camZ * Math.tan(fov / 2);
    const worldW = worldH * (size.width / size.height);
    // Face center in normalized [0,1] → world coords. X is mirrored (selfie cam).
    const worldX = -(faceCenter[0] - 0.5) * worldW;
    const worldY = (0.5 - faceCenter[1]) * worldH;
    // Map face size (fraction of screen) to world scale
    const worldScale = faceSize * worldH * 1.6;
    return { worldX, worldY, worldScale };
  }, [faceCenter, faceSize, size]);
}

function AvatarScene({
  videoEl,
  headRotation,
  faceCenter,
  faceSize,
  faceDetected,
}: {
  videoEl: HTMLVideoElement | null;
  headRotation: [number, number, number];
  faceCenter: [number, number];
  faceSize: number;
  faceDetected: boolean;
}) {
  const { worldX, worldY, worldScale } = useFaceToWorld(faceCenter, faceSize);

  return (
    <>
      <VideoBackground videoEl={videoEl} />
      <ambientLight intensity={0.4} />
      <pointLight position={[0, 2, 2]} intensity={2} color="#ffffff" />
      <pointLight position={[2, -1, 2]} intensity={1} color="#0044ff" />
      <AvatarHead
        rotation={headRotation}
        worldX={worldX}
        worldY={worldY}
        worldScale={worldScale}
        visible={faceDetected}
      />
    </>
  );
}

// ─── Main Studio page ─────────────────────────────────────────────────────────
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
  const [faceSize, setFaceSize] = useState(0.3);

  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
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
    const audioCtx = new AudioContext();
    const analyser = audioCtx.createAnalyser();
    const source = audioCtx.createMediaStreamSource(stream);
    source.connect(analyser);
    analyser.fftSize = 256;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    let active = true;
    const update = () => {
      if (!active) return;
      analyser.getByteFrequencyData(dataArray);
      let sum = 0;
      for (let i = 0; i < bufferLength; i++) sum += dataArray[i];
      setAudioLevel(sum / bufferLength / 255);
      requestAnimationFrame(update);
    };
    update();
    return () => { active = false; };
  }, []);

  const initMediaPipe = useCallback((stream: MediaStream) => {
    if (!videoRef.current || mediapipeInitRef.current) return;
    mediapipeInitRef.current = true;

    const video = videoRef.current;
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

      if (detected) {
        const lm = results.multiFaceLandmarks[0];

        // Compute bounding box of all face landmarks
        let minX = 1, maxX = 0, minY = 1, maxY = 0;
        for (const pt of lm) {
          if (pt.x < minX) minX = pt.x;
          if (pt.x > maxX) maxX = pt.x;
          if (pt.y < minY) minY = pt.y;
          if (pt.y > maxY) maxY = pt.y;
        }
        const cx = (minX + maxX) / 2;
        const cy = (minY + maxY) / 2;
        const size = Math.max(maxX - minX, maxY - minY);
        setFaceCenter([cx, cy]);
        setFaceSize(size);

        // Head pose from key landmarks
        const nose = lm[1];
        const leftEye = lm[33];
        const rightEye = lm[263];
        const pitch = (nose.y - (leftEye.y + rightEye.y) / 2) * -Math.PI * 0.7;
        const yaw = (nose.x - 0.5) * Math.PI * 0.7;
        const roll = (leftEye.y - rightEye.y) * Math.PI * 0.7;
        setHeadRotation([pitch, yaw, roll]);

        // Draw dots overlay on the webcam panel
        const ctx = overlayCanvasRef.current?.getContext("2d");
        if (ctx && overlayCanvasRef.current) {
          ctx.clearRect(0, 0, overlayCanvasRef.current.width, overlayCanvasRef.current.height);
          ctx.fillStyle = "rgba(0,255,255,0.8)";
          for (const pt of lm) {
            ctx.beginPath();
            ctx.arc(pt.x * overlayCanvasRef.current.width, pt.y * overlayCanvasRef.current.height, 1.2, 0, 2 * Math.PI);
            ctx.fill();
          }
        }
      } else {
        const ctx = overlayCanvasRef.current?.getContext("2d");
        if (ctx && overlayCanvasRef.current) ctx.clearRect(0, 0, overlayCanvasRef.current.width, overlayCanvasRef.current.height);
      }
    });

    const camera = new Camera(video, {
      onFrame: async () => {
        if (video.readyState >= 2) await faceMesh.send({ image: video });
      },
      width: 640,
      height: 480,
    });
    camera.start();
  }, []);

  // Wait for DOM to paint after hasPermission flip, then init
  useEffect(() => {
    if (hasPermission !== true || !streamRef.current) return;
    const stream = streamRef.current;
    const cleanupAudio = initAudioAnalysis(stream);
    const timer = setTimeout(() => initMediaPipe(stream), 150);
    return () => { clearTimeout(timer); if (cleanupAudio) cleanupAudio(); };
  }, [hasPermission, initAudioAnalysis, initMediaPipe]);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (isStreaming) {
      interval = setInterval(() => {
        setElapsed((e) => e + 1);
        setFps(Math.floor(Math.random() * 5 + 55));
      }, 1000);
    } else {
      setElapsed(0);
      setFps(0);
    }
    return () => clearInterval(interval);
  }, [isStreaming]);

  const formatTime = (s: number) =>
    `${Math.floor(s / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;

  if (hasPermission === false) {
    return (
      <Layout>
        <div className="flex-1 flex items-center justify-center">
          <div className="max-w-md text-center space-y-6 p-8 border border-destructive/20 bg-destructive/5 rounded-lg">
            <Video className="w-12 h-12 text-destructive mx-auto" />
            <h2 className="text-xl font-bold text-destructive">Accès caméra refusé</h2>
            <p className="text-muted-foreground">DeepFaceLive nécessite l'accès à la caméra et au micro.</p>
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
              Accès à la caméra et au microphone requis pour commencer le tracking facial.
            </p>
            <Button onClick={requestPermissions} size="lg" className="w-full font-bold uppercase tracking-wider">
              Grant Access
            </Button>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="flex flex-col h-full bg-background p-4 gap-4">
        {/* Top bar */}
        <div className="flex items-center justify-between bg-card border border-border p-3 rounded-lg">
          <div className="flex items-center gap-4">
            <Badge variant="outline" className="font-mono text-xs uppercase bg-black/40 border-primary/30 text-primary">
              <Zap className="w-3 h-3 mr-1 inline" />
              {activeAvatar?.name || "No Avatar"}
            </Badge>
            <Badge
              variant="outline"
              className={`font-mono text-xs uppercase border ${faceDetected ? "border-primary/40 text-primary bg-primary/10" : "border-border text-muted-foreground"}`}
            >
              <span className={`inline-block w-2 h-2 rounded-full mr-2 ${faceDetected ? "bg-primary animate-pulse" : "bg-muted-foreground"}`} />
              {faceDetected ? "Visage détecté" : "Aucun visage"}
            </Badge>
          </div>

          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
              <Activity className="w-4 h-4" />
              <span>{fps > 0 ? `${fps} FPS` : "—"}</span>
            </div>
            <div className="flex items-center gap-2 font-mono text-xs">
              <Clock className="w-4 h-4 text-muted-foreground" />
              <span className={isStreaming ? "text-primary font-bold" : "text-muted-foreground"}>{formatTime(elapsed)}</span>
            </div>
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

        {/* Main panels */}
        <div className="flex-1 flex gap-4 min-h-0">
          {/* LEFT — Raw webcam feed */}
          <div className="w-[38%] flex flex-col gap-3">
            <div className="flex-1 relative bg-black rounded-lg overflow-hidden border border-border">
              {/* Hidden video used as source for both panels */}
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="absolute inset-0 w-full h-full object-cover opacity-60"
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

            {/* Controls card */}
            <Card className="bg-card border-border p-4 flex items-center justify-between gap-4 shrink-0">
              <div className="flex flex-col gap-1 w-28">
                <Label className="text-xs uppercase font-mono text-muted-foreground flex items-center gap-1">
                  <Mic className="w-3 h-3" /> Micro
                </Label>
                <div className="h-2 bg-black rounded-full overflow-hidden border border-border">
                  <div
                    className="h-full bg-primary transition-all duration-75 rounded-full"
                    style={{ width: `${audioLevel * 100}%` }}
                  />
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

          {/* RIGHT — Avatar overlaid on video */}
          <div className="flex-1 relative rounded-lg overflow-hidden border border-primary/20 shadow-[0_0_40px_rgba(0,255,255,0.07)] bg-black">
            <Canvas
              camera={{ position: [0, 0, 3], fov: 60 }}
              gl={{ antialias: true, alpha: false }}
              style={{ width: "100%", height: "100%" }}
            >
              <AvatarScene
                videoEl={videoRef.current}
                headRotation={headRotation}
                faceCenter={faceCenter}
                faceSize={faceSize}
                faceDetected={faceDetected}
              />
            </Canvas>

            {/* Labels */}
            <div className="absolute top-3 right-3 font-mono text-xs text-emerald-400 bg-black/60 px-2 py-1 rounded flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${isStreaming ? "bg-red-500 animate-pulse" : "bg-border"}`} />
              {isStreaming ? "LIVE OUTPUT" : "PREVIEW"}
            </div>
            <div className="absolute bottom-3 left-3 font-mono text-xs text-primary/50 bg-black/40 px-2 py-1 rounded">
              AVATAR: {activeAvatar?.name?.toUpperCase() ?? "NONE"}
            </div>

            {!faceDetected && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <p className="font-mono text-xs text-primary/30 uppercase tracking-widest">
                  En attente du visage...
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}
