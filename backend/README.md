# Virtual Human Live Avatar — Python AI Backend

This FastAPI backend handles GPU-accelerated AI features: face generation, neural avatar synthesis, and server-side MediaPipe analysis. Core face tracking runs **client-side in the browser** via MediaPipe JS — this backend is for optional AI enhancement.

## Quick Start (CPU only)

```bash
cd backend
python -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install fastapi uvicorn python-multipart pillow numpy mediapipe
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

API docs: http://localhost:8000/docs

## GPU Deployment (Recommended for Production)

### Requirements

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| GPU VRAM | 6 GB | 12–24 GB |
| GPU | NVIDIA GTX 1060 | NVIDIA RTX 3090/4090 |
| RAM | 16 GB | 32 GB |
| Storage | 20 GB | 50 GB |
| CUDA | 11.8+ | 12.1+ |

### Step 1 — Install CUDA Toolkit

Download from: https://developer.nvidia.com/cuda-downloads

```bash
nvcc --version   # Verify CUDA is installed
```

### Step 2 — Install PyTorch with CUDA

```bash
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121
```

### Step 3 — Install all dependencies

```bash
pip install -r requirements.txt
```

### Step 4 — Download AI Models

```bash
# Face synthesis model (First Order Motion Model or SadTalker)
mkdir -p models/face-synthesis

# For Stable Diffusion (face generation):
python -c "
from diffusers import StableDiffusionPipeline
pipe = StableDiffusionPipeline.from_pretrained('runwayml/stable-diffusion-v1-5')
pipe.save_pretrained('./models/stable-diffusion')
"
```

### Step 5 — Run with GPU

```bash
uvicorn main:app --host 0.0.0.0 --port 8000 --workers 1
```

Check GPU status: http://localhost:8000/health

## OBS Virtual Camera Integration

To use the rendered avatar as a virtual camera in OBS Studio:

### Option A — OBS Browser Source (Easiest)
1. Open OBS → Add Source → Browser
2. URL: `http://localhost:5173` (your frontend dev URL)
3. Width: 1920, Height: 1080
4. Right-click → Interact → Grant camera/mic permissions
5. Add Virtual Camera output in OBS

### Option B — Canvas Capture
The frontend exports the Three.js canvas stream:
```js
const stream = canvasElement.captureStream(30); // 30 fps
```
Use [OBS-VirtualCam plugin](https://github.com/Avasam/obs-virtual-cam) or [obs-browser-source](https://github.com/obsproject/obs-browser) to pipe this stream into OBS.

### Option C — Screen Capture
1. Set avatar window to full screen
2. In OBS: Add Source → Window Capture → Select avatar window
3. Use OBS Virtual Camera output

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | /health | GPU status + model availability |
| POST | /upload/face | Upload reference face image |
| POST | /generate/face | AI face generation (GPU required) |
| POST | /analyze/face | Extract face landmarks via MediaPipe |
| POST | /voice/modulate | Voice modulation presets |
| POST | /synthesize/avatar | Neural avatar synthesis |

## Architecture

```
Browser (Frontend)
├── MediaPipe JS — real-time face + pose tracking (no GPU needed)
├── Three.js — 3D avatar rendering
├── Web Audio API — mic capture + lip sync
└── Canvas captureStream → OBS

Python Backend (Optional, GPU-accelerated)
├── FastAPI
├── MediaPipe Python — server-side face analysis
├── Stable Diffusion — AI face generation
└── Neural synthesis — avatar driving
```

## Environment Variables

```env
# Optional — for production deployments
MODEL_PATH=./models
UPLOAD_PATH=./uploads
MAX_UPLOAD_SIZE_MB=10
CUDA_VISIBLE_DEVICES=0
```
