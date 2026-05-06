import React, { useEffect, useRef, useState } from "react";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useGetActiveAvatar, useGetConfig } from "@workspace/api-client-react";
import { Play, Square, Video, Mic, Activity, Clock, Zap } from "lucide-react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Environment, ContactShadows, Wireframe } from "@react-three/drei";
import * as THREE from "three";
import { FaceMesh } from "@mediapipe/face_mesh";
import { Camera } from "@mediapipe/camera_utils";

// Dummy Geometric Avatar
function GeometricAvatar({ rotation }: { rotation: [number, number, number] }) {
  const meshRef = useRef<THREE.Mesh>(null);
  
  useFrame(() => {
    if (meshRef.current) {
      // Smooth interpolation to target rotation
      meshRef.current.rotation.x = THREE.MathUtils.lerp(meshRef.current.rotation.x, rotation[0], 0.1);
      meshRef.current.rotation.y = THREE.MathUtils.lerp(meshRef.current.rotation.y, rotation[1], 0.1);
      meshRef.current.rotation.z = THREE.MathUtils.lerp(meshRef.current.rotation.z, rotation[2], 0.1);
    }
  });

  return (
    <group>
      <mesh ref={meshRef} position={[0, 0, 0]}>
        <icosahedronGeometry args={[1, 2]} />
        <meshStandardMaterial 
          color="#00ffff" 
          wireframe={false} 
          emissive="#00aaaa"
          emissiveIntensity={0.2}
          roughness={0.2}
          metalness={0.8}
        />
        <Wireframe simplify={true} stroke={"#00ffff"} thickness={0.02} fillMix={0} />
      </mesh>
    </group>
  );
}

export default function Studio() {
  const { data: activeAvatar } = useGetActiveAvatar();
  const { data: config } = useGetConfig();

  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [faceDetected, setFaceDetected] = useState(false);
  const [fps, setFps] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [audioLevel, setAudioLevel] = useState(0);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  
  // Head pose derived from mediapipe
  const [headRotation, setHeadRotation] = useState<[number, number, number]>([0, 0, 0]);

  // Request Permissions
  const requestPermissions = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setHasPermission(true);
      initMediaPipe(stream);
      initAudioAnalysis(stream);
    } catch (err) {
      console.error(err);
      setHasPermission(false);
    }
  };

  const initAudioAnalysis = (stream: MediaStream) => {
    const audioCtx = new AudioContext();
    const analyser = audioCtx.createAnalyser();
    const source = audioCtx.createMediaStreamSource(stream);
    source.connect(analyser);
    analyser.fftSize = 256;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const updateAudio = () => {
      if (!streamRef.current) return;
      analyser.getByteFrequencyData(dataArray);
      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        sum += dataArray[i];
      }
      setAudioLevel(sum / bufferLength / 255); // 0 to 1
      requestAnimationFrame(updateAudio);
    };
    updateAudio();
  };

  const initMediaPipe = (stream: MediaStream) => {
    if (!videoRef.current || !canvasRef.current) return;

    const faceMesh = new FaceMesh({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
    });

    faceMesh.setOptions({
      maxNumFaces: 1,
      refineLandmarks: true,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5
    });

    faceMesh.onResults((results) => {
      setFaceDetected(results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0);
      
      const ctx = canvasRef.current?.getContext('2d');
      if (ctx && canvasRef.current && videoRef.current) {
        ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
        
        if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
          const landmarks = results.multiFaceLandmarks[0];
          
          // Draw points
          ctx.fillStyle = '#00ffff';
          for (const pt of landmarks) {
            ctx.beginPath();
            ctx.arc(pt.x * canvasRef.current.width, pt.y * canvasRef.current.height, 1, 0, 2 * Math.PI);
            ctx.fill();
          }

          // Very simple pose estimation (yaw, pitch, roll approximation)
          const nose = landmarks[1];
          const leftEye = landmarks[33];
          const rightEye = landmarks[263];
          
          // Pitch approximation
          const pitch = (nose.y - (leftEye.y + rightEye.y)/2) * -Math.PI;
          // Yaw approximation
          const yaw = (nose.x - 0.5) * -Math.PI;
          // Roll approximation
          const roll = (leftEye.y - rightEye.y) * Math.PI;
          
          setHeadRotation([pitch, yaw, roll]);
        }
      }
    });

    const camera = new Camera(videoRef.current, {
      onFrame: async () => {
        if (videoRef.current) {
          await faceMesh.send({ image: videoRef.current });
        }
      },
      width: 640,
      height: 480
    });
    camera.start();
  };

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isStreaming) {
      interval = setInterval(() => {
        setElapsed(e => e + 1);
        setFps(Math.floor(Math.random() * 5 + 55)); // Fake FPS 55-60
      }, 1000);
    } else {
      setElapsed(0);
      setFps(0);
    }
    return () => clearInterval(interval);
  }, [isStreaming]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  if (hasPermission === false) {
    return (
      <Layout>
        <div className="flex-1 flex items-center justify-center bg-background/50">
          <div className="max-w-md text-center space-y-6 p-8 border border-destructive/20 bg-destructive/5 rounded-lg">
            <Video className="w-12 h-12 text-destructive mx-auto" />
            <h2 className="text-xl font-bold text-destructive">Camera Access Denied</h2>
            <p className="text-muted-foreground">DeepFaceLive requires camera and microphone access to map your face to the digital avatar.</p>
            <Button onClick={requestPermissions} variant="default" className="w-full">
              Retry Permission
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
              We need access to your camera and microphone to begin the live face tracking session.
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
        {/* Top Bar */}
        <div className="flex items-center justify-between bg-card border border-border p-3 rounded-lg shadow-sm">
          <div className="flex items-center gap-4">
            <Badge variant="outline" className="font-mono text-xs uppercase bg-black/40 border-primary/30 text-primary">
              <Zap className="w-3 h-3 mr-1 inline" />
              Active Profile: {activeAvatar?.name || "None"}
            </Badge>
            <Badge variant={faceDetected ? "default" : "destructive"} className="font-mono text-xs uppercase">
              {faceDetected ? "Face Detected" : "No Face"}
            </Badge>
          </div>
          
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
              <Activity className="w-4 h-4" />
              <span>{fps} FPS</span>
            </div>
            <div className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
              <Clock className="w-4 h-4" />
              <span className={isStreaming ? "text-primary font-bold" : ""}>{formatTime(elapsed)}</span>
            </div>
            
            {isStreaming ? (
              <Button variant="destructive" size="sm" onClick={() => setIsStreaming(false)} className="animate-pulse">
                <Square className="w-4 h-4 mr-2 fill-current" /> STOP STREAM
              </Button>
            ) : (
              <Button variant="default" size="sm" onClick={() => setIsStreaming(true)} className="bg-emerald-600 hover:bg-emerald-500 text-white">
                <Play className="w-4 h-4 mr-2 fill-current" /> GO LIVE
              </Button>
            )}
          </div>
        </div>

        {/* Main Split View */}
        <div className="flex-1 flex gap-4 min-h-0">
          {/* Left: Input */}
          <div className="w-1/2 flex flex-col gap-4">
            <Card className="flex-1 bg-black overflow-hidden relative border-border flex items-center justify-center">
              <video 
                ref={videoRef} 
                autoPlay 
                playsInline 
                muted 
                className="absolute inset-0 w-full h-full object-cover opacity-50"
              />
              <canvas 
                ref={canvasRef}
                width={640}
                height={480}
                className="absolute inset-0 w-full h-full object-cover"
              />
              <div className="absolute top-4 left-4 font-mono text-xs text-primary/70 bg-black/50 px-2 py-1 rounded">
                SOURCE: WEBCAM
              </div>
            </Card>

            {/* Controls */}
            <Card className="h-24 bg-card border-border p-4 flex items-center justify-between gap-8">
              <div className="flex-1 flex items-center gap-4">
                <div className="flex flex-col gap-1 w-24">
                  <Label className="text-xs uppercase font-mono text-muted-foreground">Mic Input</Label>
                  <div className="h-2 bg-black rounded-full overflow-hidden border border-border">
                    <div 
                      className="h-full bg-primary transition-all duration-75"
                      style={{ width: `${audioLevel * 100}%` }}
                    />
                  </div>
                </div>
              </div>
              
              <div className="flex items-center gap-6">
                <div className="flex items-center space-x-2">
                  <Switch 
                    id="lip-sync" 
                    checked={config?.enableLipSync ?? true}
                    disabled={isStreaming}
                  />
                  <Label htmlFor="lip-sync" className="font-mono text-xs uppercase cursor-pointer">Lip Sync</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Switch 
                    id="voice-mod" 
                    checked={config?.enableVoiceModulation ?? false}
                    disabled={isStreaming}
                  />
                  <Label htmlFor="voice-mod" className="font-mono text-xs uppercase cursor-pointer">Voice Mod</Label>
                </div>
              </div>
            </Card>
          </div>

          {/* Right: Output Canvas */}
          <div className="w-1/2">
            <Card className="h-full bg-[#0a0a0a] overflow-hidden relative border-primary/30 shadow-[0_0_30px_rgba(0,255,255,0.05)]">
              <div className="absolute inset-0">
                <Canvas camera={{ position: [0, 0, 4], fov: 45 }}>
                  <color attach="background" args={['#0a0a0a']} />
                  <ambientLight intensity={0.5} />
                  <spotLight position={[10, 10, 10]} angle={0.15} penumbra={1} />
                  <pointLight position={[-10, -10, -10]} intensity={0.5} />
                  <GeometricAvatar rotation={headRotation} />
                  <ContactShadows position={[0, -1.5, 0]} opacity={0.4} scale={10} blur={2} far={4} />
                  <Environment preset="city" />
                  
                  {/* Grid floor */}
                  <gridHelper args={[20, 20, '#004444', '#001111']} position={[0, -1.5, 0]} />
                </Canvas>
              </div>

              <div className="absolute top-4 right-4 font-mono text-xs text-emerald-500 bg-black/50 px-2 py-1 rounded flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${isStreaming ? 'bg-red-500 animate-pulse' : 'bg-muted'}`} />
                {isStreaming ? 'LIVE OUTPUT' : 'PREVIEW'}
              </div>
            </Card>
          </div>
        </div>
      </div>
    </Layout>
  );
}
