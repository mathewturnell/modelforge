"""Inference contract with an honest deterministic offline qualification mode."""

from __future__ import annotations

import hashlib
import io
import json
import math
import os
from pathlib import Path
from typing import Any

from . import MODEL_ID, MODEL_REVISION, MODEL_VISION_HIDDEN_SIZE
from .dataset import load_index
def validate_adapter_checkpoint(checkpoint, torch, *, expected_classes=None):
    """Validate only the adapter shape needed by local inference."""
    required = {"protocol", "model_id", "model_revision", "model_weights_sha256", "classes", "rank", "down", "up"}
    if not isinstance(checkpoint, dict) or set(checkpoint) != required:
        raise ValueError("Adapter binding or schema is invalid")
    classes, rank = checkpoint["classes"], checkpoint["rank"]
    if expected_classes is not None and classes != expected_classes:
        raise ValueError("Adapter class order is invalid")
    if isinstance(rank, bool) or not isinstance(rank, int) or not 1 <= rank <= 256:
        raise ValueError("Adapter rank is invalid")
    if tuple(checkpoint["down"]["weight"].shape) != (rank, MODEL_VISION_HIDDEN_SIZE):
        raise ValueError("Adapter down tensor shape is invalid")
    if tuple(checkpoint["up"]["weight"].shape) != (len(classes), rank):
        raise ValueError("Adapter up tensor shape is invalid")
    if not all(bool(torch.isfinite(value["weight"]).all()) for value in (checkpoint["down"], checkpoint["up"])):
        raise ValueError("Adapter tensor values are invalid")
    return classes, rank


def _softmax(values: list[float]) -> list[float]:
    peak = max(values)
    weights = [math.exp(value - peak) for value in values]
    total = sum(weights)
    return [value / total for value in weights]


def _bytes_feature(payload: bytes) -> tuple[float, float, float]:
    digest = hashlib.sha256(payload).digest()
    return tuple(round(digest[index] / 255.0, 6) for index in range(3))  # type: ignore[return-value]


def image_media_type(payload: bytes) -> str:
    if not 1 <= len(payload) <= 10 * 1024 * 1024:
        raise ValueError("Image must be between 1 byte and 10 MiB")
    signatures = (
        (payload.startswith(b"\xff\xd8\xff"), "JPEG", "image/jpeg"),
        (payload.startswith(b"\x89PNG\r\n\x1a\n"), "PNG", "image/png"),
        (payload.startswith(b"RIFF") and payload[8:12] == b"WEBP", "WEBP", "image/webp"),
        (payload.startswith(b"P3\n") or payload.startswith(b"P6\n"), "PPM", "image/x-portable-pixmap"),
    )
    expected = next(((image_format, media) for matches, image_format, media in signatures if matches), None)
    if expected is None:
        raise ValueError("Upload a JPEG, PNG, WebP, or PPM image")
    try:
        from PIL import Image

        with Image.open(io.BytesIO(payload)) as image:
            if image.format != expected[0]:
                raise ValueError("Image bytes do not match their file signature")
            if image.width * image.height > 25_000_000:
                raise ValueError("Image dimensions exceed 25 megapixels")
            image.load()
    except ValueError:
        raise
    except (ImportError, OSError) as exc:
        if isinstance(exc, ImportError):
            raise RuntimeError("Pillow is required to validate image uploads") from exc
        raise ValueError("Image bytes are malformed or truncated") from exc
    return expected[1]


def validate_image_payload(payload: bytes) -> None:
    image_media_type(payload)


def load_pinned_pretrained(auto_processor, auto_model, model_source: str):
    """Load only the exact revision or an explicitly baked local directory."""
    revision = MODEL_REVISION if model_source == MODEL_ID else None
    processor = auto_processor.from_pretrained(
        model_source, revision=revision, local_files_only=True,
    )
    model = auto_model.from_pretrained(
        model_source, revision=revision, local_files_only=True,
    )
    return processor, model


def representative_records(records: list[dict[str, Any]], maximum: int = 24) -> list[dict[str, Any]]:
    """Choose one deterministic training-derived example per class."""
    by_label: dict[str, dict[str, Any]] = {}
    for row in records:
        if row.get("split") != "train":
            continue
        current = by_label.get(row["label"])
        if current is None or hashlib.sha256(row["id"].encode()).hexdigest() < hashlib.sha256(
            current["id"].encode()
        ).hexdigest():
            by_label[row["label"]] = row
    return sorted(
        by_label.values(), key=lambda row: hashlib.sha256(row["id"].encode()).hexdigest(),
    )[:maximum]


def _similar_payload(root: Path, records: list[dict[str, Any]], identity: str) -> tuple[bytes, str]:
    row = next((item for item in records if item.get("id") == identity), None)
    if row is None:
        raise KeyError("Similar example was not found")
    relative = Path(str(row.get("path") or ""))
    path = (root / relative).resolve()
    if relative.is_absolute() or ".." in relative.parts or not path.is_relative_to(root.resolve()):
        raise ValueError("Similar example path is unsafe")
    payload = path.read_bytes()
    validate_image_payload(payload)
    return payload, image_media_type(payload)


class FixtureEngine:
    """Stable contract fixture; deliberately not presented as SigLIP evidence."""

    def __init__(self, index_path: str | Path):
        self.index = load_index(index_path)
        self.labels = list(self.index["classes"])
        self.records = list(self.index["records"])
        self.root = Path(index_path).resolve().parent
        self.mode_label = "Synthetic demo — not SigLIP"

    def similar_image(self, identity: str) -> tuple[bytes, str]:
        return _similar_payload(self.root, self.records, identity)

    def predict(self, payload: bytes, *, adapter: str | Path | None = None) -> dict[str, Any]:
        validate_image_payload(payload)
        feature = _bytes_feature(payload)
        base_raw = [
            sum(feature[offset] * ((index + offset * 7) % 13 + 1) for offset in range(3))
            for index, _label in enumerate(self.labels)
        ]
        trained_raw = [score + (0.35 if index % 4 == 0 else -0.05) for index, score in enumerate(base_raw)]
        base = _softmax(base_raw)
        trained = _softmax(trained_raw) if adapter else base

        def top(scores: list[float]) -> list[dict[str, Any]]:
            return [
                {"label": self.labels[index].replace("_", " "), "score": round(scores[index], 6)}
                for index in sorted(range(len(scores)), key=scores.__getitem__, reverse=True)[:5]
            ]

        similar = []
        for row in self.records:
            candidate = tuple(float(value) for value in row.get("feature", [0, 0, 0]))
            distance = math.sqrt(sum((feature[i] - candidate[i]) ** 2 for i in range(3)))
            similar.append((distance, row))
        return {
            "protocol": "tastematch.inference/v1",
            "model_id": MODEL_ID,
            "evidence_mode": "deterministic-synthetic-fixture",
            "base": top(base),
            "trained": top(trained),
            "comparison": {
                "adapter_loaded": bool(adapter),
                "base_top1": top(base)[0]["label"],
                "trained_top1": top(trained)[0]["label"],
            },
            "similar": [
                {"id": row["id"], "label": row["label"].replace("_", " ")}
                for _distance, row in sorted(similar, key=lambda item: (item[0], item[1]["id"]))[:4]
            ],
            "notice": "Synthetic fixture scores qualify the UI contract; they are not SigLIP accuracy evidence.",
        }


class SiglipEngine:
    """Pinned live engine for local, user-supplied model and dataset caches."""

    def __init__(self, index_path: str | Path, adapter_path: str | Path):
        try:
            import torch
            from PIL import Image
            from transformers import AutoModel, AutoProcessor
        except ImportError as exc:
            raise RuntimeError("Install the exact TasteMatch runtime dependencies for live inference") from exc
        self.torch = torch
        self.Image = Image
        self.index = load_index(index_path)
        declared_root = Path(self.index["source_root"])
        self.root = (
            (Path(index_path).resolve().parent / declared_root).resolve()
            if not declared_root.is_absolute() else declared_root.resolve()
        )
        self.labels = list(self.index["classes"])
        self.records = list(self.index["records"])
        self.device = "cuda:0" if torch.cuda.is_available() else "cpu"
        self.mode_label = "Pinned SigLIP + selected adapter"
        model_source = os.environ.get("TASTEMATCH_MODEL_PATH", MODEL_ID)
        self.processor, self.model = load_pinned_pretrained(
            AutoProcessor, AutoModel, model_source,
        )
        self.model = self.model.to(self.device).eval()
        checkpoint = torch.load(adapter_path, map_location=self.device, weights_only=True)
        hidden = int(self.model.config.vision_config.hidden_size)
        if hidden != MODEL_VISION_HIDDEN_SIZE:
            raise ValueError("Pinned SigLIP vision width does not match the adapter contract")
        _classes, rank = validate_adapter_checkpoint(
            checkpoint, torch, expected_classes=self.labels,
        )
        self.down = torch.nn.Linear(hidden, rank, bias=False, device=self.device)
        self.up = torch.nn.Linear(rank, len(self.labels), bias=False, device=self.device)
        self.down.load_state_dict(checkpoint["down"])
        self.up.load_state_dict(checkpoint["up"])
        self.down.eval()
        self.up.eval()
        self.representatives = representative_records(self.records)
        self._representative_features = None

    def _image_feature(self, image):
        inputs = self.processor(images=[image], return_tensors="pt").to(self.device)
        with self.torch.inference_mode():
            return self.model.get_image_features(**inputs).float()

    def similar_image(self, identity: str) -> tuple[bytes, str]:
        return _similar_payload(self.root, self.records, identity)

    def _similar_candidates(self):
        if self._representative_features is None:
            images = [self.Image.open(self.root / row["path"]).convert("RGB") for row in self.representatives]
            inputs = self.processor(images=images, return_tensors="pt").to(self.device)
            with self.torch.inference_mode():
                self._representative_features = self.model.get_image_features(**inputs).float()
        return self._representative_features

    def predict(self, payload: bytes, *, adapter: str | Path | None = None) -> dict[str, Any]:
        validate_image_payload(payload)
        image = self.Image.open(io.BytesIO(payload)).convert("RGB")
        prompts = [f"a photo of {label.replace('_', ' ')}" for label in self.labels]
        inputs = self.processor(text=prompts, images=image, padding="max_length", return_tensors="pt").to(self.device)
        with self.torch.inference_mode():
            outputs = self.model(**inputs)
            base_scores = outputs.logits_per_image[0].float().sigmoid()
            feature = self.model.get_image_features(pixel_values=inputs["pixel_values"]).float()
            trained_scores = self.up(self.down(feature)).float().softmax(dim=-1)[0]

        def top(scores):
            values, indices = self.torch.topk(scores, k=5)
            return [
                {"label": self.labels[int(index)].replace("_", " "), "score": round(float(score), 6)}
                for score, index in zip(values.cpu(), indices.cpu(), strict=True)
            ]

        vectors = self._similar_candidates()
        similarities = self.torch.nn.functional.cosine_similarity(feature, vectors)
        similar = [
            (float(similarity), row)
            for similarity, row in zip(similarities.cpu(), self.representatives, strict=True)
        ]
        base = top(base_scores)
        trained = top(trained_scores)
        return {
            "protocol": "tastematch.inference/v1",
            "model_id": MODEL_ID,
            "evidence_mode": "pinned-siglip-local-runtime",
            "base": base,
            "trained": trained,
            "comparison": {
                "adapter_loaded": True,
                "base_top1": base[0]["label"],
                "trained_top1": trained[0]["label"],
            },
            "similar": [
                {"id": row["id"], "label": row["label"].replace("_", " "),
                 "provenance": "deterministic training-derived representative"}
                for _similarity, row in sorted(similar, key=lambda item: (-item[0], item[1]["id"]))[:4]
            ],
            "notice": "Local pinned SigLIP and selected-adapter output; inspect run evidence before drawing accuracy conclusions.",
        }


def dumps(result: dict[str, Any]) -> bytes:
    return (json.dumps(result, sort_keys=True) + "\n").encode("utf-8")
