# KhataFlow (खाताफ्लो) 🧾🎙️
### Production-Ready Low-Latency Indic Voice Ledger for Indian Kirana Stores

KhataFlow is a real-time, low-latency Voice Khata web application tailored for Indian Kirana shopkeepers. It processes code-mixed Indic speech (Hindi, Hinglish, English) over WebSockets, extracts financial credit/payment intents with **Groq LLaMA-3.1-70B**, maintains an atomic **SQLite ledger**, and streams synthesized speech via **Gnani Timbre v3.0** with **sub-1.5 second latency**.

---

## 🏗️ Architecture & Core Modules

1. **AudioWorklet Web Audio Pipeline (`frontend/public/pcm-processor.js`, `frontend/lib/audioRecorder.ts`)**
   - Captures continuous 16kHz 16-bit mono Linear PCM directly from the microphone.
   - Computes live oscilloscope audio waveform data.
   - Streams binary frames via persistent WebSocket.

2. **Multi-Engine Speech-to-Text Pipeline (`backend/services/gnani_stt.py`)**
   - Primary: **Gnani Prisma v3.0 STT** (`wss://api.vachana.ai/stt/v3/stream`).
   - Cloud Fallback: **Groq Whisper** (`whisper-large-v3-turbo`) when `GROQ_API_KEY` is present.
   - Local Offline Fallback: **Local Vosk Engine** constrained to domain ledger vocabulary (`udhaar`, `jama`, `diya`, numbers, and dynamic customer names).
   - Silence rejection via RMS Voice Activity Detection (VAD).

3. **Intent & Entity Extraction (`backend/services/intent_engine.py`)**
   - Groq API (`llama-3.1-70b-versatile` in JSON Mode) + High-precision bi-script Indic parser (Devanagari + Hinglish).
   - Multi-action inputs: *"Ramesh ka 340 udhaar, kal 200 diya tha"* -> parses both `ADD_CREDIT` and `RECORD_PAYMENT`.
   - Spoken correction: *"Nahi 340 nahi, 430 tha"* -> atomic balance diff recalculation.

4. **Smart Ledger State Machine & SQLite (`backend/database/ledger.py`, `models.py`)**
   - Tables: `customers` and `transactions` with atomic balance tracking.
   - Ambiguity disambiguation (e.g. multiple "Ramesh"s).
   - Real-time balance queries (*"Ramesh ka total kitna baaki hai?"*, *"Aaj kitna udhaar gaya?"*).

5. **Gnani Timbre v3.0 TTS Client (`backend/services/gnani_tts.py`)**
   - Connects to `wss://api.vachana.ai/api/v1/tts` to stream Indic audio buffers back.
   - Measures real-time **Time-to-First-Audio (TTFA)** to guarantee < 1500 ms response times.

6. **Split-Screen Dashboard (`frontend/components/LedgerCards.tsx`, `LiveVisualizer.tsx`)**
   - Left Screen: Color-coded Kirana khata cards with live row-highlight pulses on updates.
   - Right Screen: Judge Live Demo Visualizer with real-time waveform, streaming transcript, STT engine telemetry, structured JSON viewer, and latency counter.

---

## 🚀 Quickstart & Setup

### Prerequisites
- **Node.js** (v18+ recommended) & **npm**
- **Python** (3.10+)

### 1. Clone & Configure Environment
```bash
git clone https://github.com/<your-username>/KhataFlow.git
cd KhataFlow

# Copy environment config
cp .env.example .env
```
Edit `.env` if you have cloud API keys:
```env
GNANI_API_KEY=your_gnani_api_key
GROQ_API_KEY=your_groq_api_key
```
*(Note: If no API keys are provided, KhataFlow automatically runs locally via offline Vosk speech recognition and the built-in Indic intent parser).*

---

### 2. Backend Setup (FastAPI)

```bash
# Create and activate virtual environment
python -m venv backend/venv

# Windows:
backend\venv\Scripts\activate
# macOS/Linux:
# source backend/venv/bin/activate

# Install dependencies
pip install -r backend/requirements.txt

# (Optional) Download offline Vosk acoustic models for 100% offline speech recognition
python backend/scripts/download_models.py

# Start FastAPI server
python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload
```

---

### 3. Frontend Setup (Next.js)

Open a new terminal:
```bash
cd frontend

# Install packages
npm install

# Run development server
npm run dev
```

Open **[http://localhost:3000](http://localhost:3000)** in your browser.

---

## 🧪 Testing & Verification
You can verify the backend WebSocket pipeline using the included automated test scripts:
```bash
# Verify Vosk pipeline with sample audio
python backend/scripts/check_vosk_pipeline.py <path_to_wav>

# End-to-end WebSocket stream test
python backend/scripts/ws_e2e_test.py <path_to_wav> http://localhost:8000/ws
```

---

## 📄 License
MIT License. Free to use and develop for educational, commercial, or hackathon purposes.
