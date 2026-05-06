"""
Virtual Human Live Avatar — Python FastAPI Backend
For AI/ML processing: face generation, voice synthesis, GPU acceleration.

Run locally:
    uvicorn main:app --reload --host 0.0.0.0 --port 8000

GPU deployment: see README.md for local GPU setup instructions.
"""

import os
import io
import uuid
import logging
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, File, UploadFile, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="Virtual Human Live Avatar — AI Backend",
    description="Python FastAPI backend for GPU-accelerated face tracking, synthesis, and voice processing.",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_DIR = Path("uploads")
UPLOAD_DIR.mkdir(exist_ok=True)
MODELS_DIR = Path("models")
MODELS_DIR.mkdir(exist_ok=True)


# ── Models ────────────────────────────────────────────────────────────────────

class FaceGenerationRequest(BaseModel):
    prompt: str
    negative_prompt: Optional[str] = "blurry, low quality, distorted"
    width: int = 512
    height: int = 512
    num_inference_steps: int = 30
    guidance_scale: float = 7.5
    seed: Optional[int] = None


class FaceGenerationResponse(BaseModel):
    job_id: str
    status: str
    image_url: Optional[str] = None
    message: str


class VoiceModulationRequest(BaseModel):
    pitch_shift: float = 0.0  # semitones, -12 to +12
    speed: float = 1.0
    reverb: float = 0.0


class AvatarSynthesisRequest(BaseModel):
    source_image_id: str
    driver_video_id: Optional[str] = None
    expression_multiplier: float = 1.0


# ── Health ────────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {
        "status": "ok",
        "gpu_available": _check_gpu(),
        "models_loaded": _check_models(),
    }


# ── Face Image Upload ──────────────────────────────────────────────────────────

@app.post("/upload/face")
async def upload_face_image(file: UploadFile = File(...)):
    """Upload a reference face image for avatar creation."""
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="File must be an image")

    ext = Path(file.filename or "upload.jpg").suffix or ".jpg"
    filename = f"{uuid.uuid4()}{ext}"
    file_path = UPLOAD_DIR / filename

    content = await file.read()
    if len(content) > 10 * 1024 * 1024:  # 10MB limit
        raise HTTPException(status_code=400, detail="File too large (max 10MB)")

    with open(file_path, "wb") as f:
        f.write(content)

    logger.info(f"Uploaded face image: {filename} ({len(content)} bytes)")

    return {
        "id": filename,
        "filename": filename,
        "size": len(content),
        "url": f"/uploads/{filename}",
        "message": "Face image uploaded successfully",
    }


# ── AI Face Generation ─────────────────────────────────────────────────────────

@app.post("/generate/face", response_model=FaceGenerationResponse)
async def generate_face(request: FaceGenerationRequest, background_tasks: BackgroundTasks):
    """
    Generate a synthetic face using Stable Diffusion.
    Requires GPU. Falls back to a mock response when no GPU is available.
    """
    job_id = str(uuid.uuid4())

    if not _check_gpu():
        logger.warning("No GPU available — returning mock response")
        return FaceGenerationResponse(
            job_id=job_id,
            status="mock",
            image_url=None,
            message="GPU not available. Install PyTorch with CUDA for real generation. See README.md.",
        )

    background_tasks.add_task(_generate_face_task, job_id, request)

    return FaceGenerationResponse(
        job_id=job_id,
        status="queued",
        message="Face generation queued. Poll /jobs/{job_id} for status.",
    )


# ── Voice Modulation ───────────────────────────────────────────────────────────

@app.post("/voice/modulate")
async def modulate_voice(request: VoiceModulationRequest):
    """
    Apply voice modulation parameters.
    Real-time voice processing happens client-side via Web Audio API.
    This endpoint stores/retrieves modulation presets.
    """
    return {
        "pitch_shift": request.pitch_shift,
        "speed": request.speed,
        "reverb": request.reverb,
        "message": "Voice modulation parameters accepted. Apply client-side via Web Audio API.",
    }


# ── Avatar Synthesis ───────────────────────────────────────────────────────────

@app.post("/synthesize/avatar")
async def synthesize_avatar(request: AvatarSynthesisRequest, background_tasks: BackgroundTasks):
    """
    Drive a source face image with motion from the webcam stream.
    Uses First Order Model or similar neural face synthesis.
    """
    job_id = str(uuid.uuid4())

    if not _check_gpu():
        return {
            "job_id": job_id,
            "status": "mock",
            "message": "GPU not available for neural face synthesis. See README.md for GPU setup.",
        }

    background_tasks.add_task(_synthesize_avatar_task, job_id, request)

    return {
        "job_id": job_id,
        "status": "queued",
        "message": "Avatar synthesis queued.",
    }


# ── MediaPipe Analysis ─────────────────────────────────────────────────────────

@app.post("/analyze/face")
async def analyze_face(file: UploadFile = File(...)):
    """
    Detect and extract face landmarks from an uploaded image using MediaPipe.
    Returns 468 face mesh landmarks.
    """
    try:
        import mediapipe as mp
        import numpy as np
        from PIL import Image

        content = await file.read()
        image = Image.open(io.BytesIO(content)).convert("RGB")
        img_array = np.array(image)

        mp_face_mesh = mp.solutions.face_mesh
        with mp_face_mesh.FaceMesh(
            static_image_mode=True,
            max_num_faces=1,
            refine_landmarks=True,
        ) as face_mesh:
            results = face_mesh.process(img_array)

        if not results.multi_face_landmarks:
            return {"detected": False, "landmarks": [], "message": "No face detected"}

        landmarks = [
            {"x": lm.x, "y": lm.y, "z": lm.z}
            for lm in results.multi_face_landmarks[0].landmark
        ]

        return {
            "detected": True,
            "landmarks": landmarks,
            "landmark_count": len(landmarks),
            "message": "Face landmarks extracted successfully",
        }

    except ImportError:
        return {
            "detected": False,
            "landmarks": [],
            "message": "MediaPipe not installed. Run: pip install mediapipe",
        }
    except Exception as e:
        logger.error(f"Face analysis error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ── Helpers ────────────────────────────────────────────────────────────────────

def _check_gpu() -> bool:
    try:
        import torch
        return torch.cuda.is_available()
    except ImportError:
        return False


def _check_models() -> dict:
    return {
        "stable_diffusion": (MODELS_DIR / "stable-diffusion").exists(),
        "face_synthesis": (MODELS_DIR / "face-synthesis").exists(),
    }


async def _generate_face_task(job_id: str, request: FaceGenerationRequest):
    """Background task for face generation via Stable Diffusion."""
    try:
        from diffusers import StableDiffusionPipeline
        import torch

        pipe = StableDiffusionPipeline.from_pretrained(
            "runwayml/stable-diffusion-v1-5",
            torch_dtype=torch.float16,
        )
        pipe = pipe.to("cuda")

        generator = torch.Generator("cuda")
        if request.seed is not None:
            generator = generator.manual_seed(request.seed)

        image = pipe(
            prompt=f"portrait photo, {request.prompt}, photorealistic, 4k",
            negative_prompt=request.negative_prompt,
            width=request.width,
            height=request.height,
            num_inference_steps=request.num_inference_steps,
            guidance_scale=request.guidance_scale,
            generator=generator,
        ).images[0]

        filename = f"generated_{job_id}.png"
        image.save(UPLOAD_DIR / filename)
        logger.info(f"Generated face image: {filename}")

    except Exception as e:
        logger.error(f"Face generation failed for job {job_id}: {e}")


async def _synthesize_avatar_task(job_id: str, request: AvatarSynthesisRequest):
    """Background task for neural avatar synthesis."""
    logger.info(f"Avatar synthesis job {job_id} started for source {request.source_image_id}")
