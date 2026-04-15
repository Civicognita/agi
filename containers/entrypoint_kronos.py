"""
Aionima Kronos-base Runtime — FastAPI server for financial time series forecasting.

Loads Kronos model + tokenizer from HuggingFace Hub on startup using the custom
classes from the cloned Kronos repository at /kronos/model/.

Environment variables:
  HF_MODEL_ID       — Kronos model ID (default: NeoQuasar/Kronos-base)
  HF_TOKENIZER_ID   — Kronos tokenizer ID (default: NeoQuasar/Kronos-Tokenizer-base)
  PORT              — HTTP port to listen on (default: 8000)
  DEVICE            — Inference device: "cpu" or "cuda:N" (default: auto-detect)

Endpoints:
  GET  /health    — Liveness check, returns model load status.
  POST /predict   — Accepts OHLCV data, returns price forecast.
"""

import os
import sys
import logging
from contextlib import asynccontextmanager
from typing import List, Optional

import torch
import uvicorn
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

# Add the Kronos source repo to the Python path so model/ can be imported.
sys.path.insert(0, "/kronos")

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("aionima-kronos")

HF_MODEL_ID = os.environ.get("HF_MODEL_ID", "NeoQuasar/Kronos-base")
HF_TOKENIZER_ID = os.environ.get("HF_TOKENIZER_ID", "NeoQuasar/Kronos-Tokenizer-base")
PORT = int(os.environ.get("PORT", "8000"))

# Default device: use CUDA if available, otherwise CPU.
_auto_device = "cuda:0" if torch.cuda.is_available() else "cpu"
DEVICE = os.environ.get("DEVICE", _auto_device)

# Global model state — populated during startup lifespan.
_predictor = None
_device = DEVICE
_ready = False


def load_models() -> None:
    """Load Kronos tokenizer and model from HuggingFace Hub."""
    global _predictor, _device, _ready

    import pandas  # noqa: F401 — ensure pandas is available before model load

    log.info(f"Loading Kronos tokenizer from {HF_TOKENIZER_ID}...")
    from model import Kronos, KronosTokenizer, KronosPredictor  # type: ignore[import]

    tokenizer = KronosTokenizer.from_pretrained(HF_TOKENIZER_ID)

    log.info(f"Loading Kronos model from {HF_MODEL_ID}...")
    model = Kronos.from_pretrained(HF_MODEL_ID)
    model = model.to(_device)
    model.eval()

    _predictor = KronosPredictor(
        model=model,
        tokenizer=tokenizer,
        device=_device,
        max_context=512,
    )

    _ready = True
    log.info(f"Kronos ready on {_device}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    load_models()
    yield
    log.info("Shutting down Kronos server")


app = FastAPI(title="Kronos-base", version="0.1.0", lifespan=lifespan)


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------

@app.get("/health")
def health():
    return {
        "status": "ok" if _ready else "loading",
        "model": HF_MODEL_ID,
        "tokenizer": HF_TOKENIZER_ID,
        "device": _device,
    }


# ---------------------------------------------------------------------------
# Predict
# ---------------------------------------------------------------------------

class KlineData(BaseModel):
    """Historical K-line (candlestick) data for one symbol."""
    timestamps: List[str]        # ISO-format dates, e.g. ["2024-01-01", "2024-01-02", ...]
    open: List[float]
    high: List[float]
    low: List[float]
    close: List[float]
    volume: List[float]


class PredictionRequest(BaseModel):
    """Kronos forecast request."""
    kline_data: KlineData
    forecast_days: int = 30       # Number of future periods to predict (pred_len)
    temperature: float = 1.0      # Sampling temperature (T)
    top_p: float = 0.9            # Nucleus sampling cutoff
    samples: int = 1              # Number of independent forecast samples


class PredictionResponse(BaseModel):
    """Kronos forecast output — one row per predicted period."""
    timestamps: List[str]
    open: List[float]
    high: List[float]
    low: List[float]
    close: List[float]
    volume: List[float]
    amount: List[float]


@app.post("/predict", response_model=PredictionResponse)
def predict(request: PredictionRequest):
    """Generate OHLCV price forecasts for the next N periods."""
    if not _ready or _predictor is None:
        raise HTTPException(status_code=503, detail="Model is still loading — please retry in a moment.")

    import pandas as pd

    kd = request.kline_data

    # Validate that all OHLCV arrays have the same length as timestamps.
    lengths = {
        "timestamps": len(kd.timestamps),
        "open": len(kd.open),
        "high": len(kd.high),
        "low": len(kd.low),
        "close": len(kd.close),
        "volume": len(kd.volume),
    }
    if len(set(lengths.values())) != 1:
        raise HTTPException(
            status_code=400,
            detail=f"OHLCV arrays must all have the same length. Got: {lengths}",
        )

    if len(kd.timestamps) == 0:
        raise HTTPException(status_code=400, detail="kline_data must contain at least one row.")

    # Build input DataFrame.
    df = pd.DataFrame({
        "open": kd.open,
        "high": kd.high,
        "low": kd.low,
        "close": kd.close,
        "volume": kd.volume,
    })
    df.index = pd.to_datetime(kd.timestamps)

    # Respect the model's 512-token context window.
    if len(df) > 512:
        df = df.iloc[-512:]

    last_ts = df.index[-1]
    target_ts = last_ts + pd.Timedelta(days=request.forecast_days)

    try:
        with torch.no_grad():
            pred_df = _predictor.predict(
                df=df,
                x_timestamp=last_ts,
                y_timestamp=target_ts,
                pred_len=request.forecast_days,
                T=request.temperature,
                top_p=request.top_p,
                sample_count=request.samples,
            )
    except Exception as exc:
        log.exception("Kronos inference failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    # Handle missing 'amount' column gracefully (some variants may not produce it).
    if "amount" not in pred_df.columns:
        pred_df["amount"] = pred_df["close"] * pred_df["volume"]

    return PredictionResponse(
        timestamps=pred_df.index.strftime("%Y-%m-%d").tolist(),
        open=pred_df["open"].tolist(),
        high=pred_df["high"].tolist(),
        low=pred_df["low"].tolist(),
        close=pred_df["close"].tolist(),
        volume=pred_df["volume"].tolist(),
        amount=pred_df["amount"].tolist(),
    )


# ---------------------------------------------------------------------------
# Entrypoint
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    log.info(f"Starting Kronos server on port {PORT}, device={DEVICE}")
    uvicorn.run(app, host="0.0.0.0", port=PORT, log_level="info")
