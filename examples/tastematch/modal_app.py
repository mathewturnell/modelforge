# Copyright (C) 2026 Mathew Turnell
# SPDX-License-Identifier: LicenseRef-ModelForge-Pending

"""Fixed Modal deployment for one bounded base-SigLIP Food-101 inference."""

from __future__ import annotations

import hashlib
import io
import json
import sys
import tempfile
from pathlib import Path
from typing import Mapping

try:
    import modal
except ImportError:  # pragma: no cover - exercised by the no-SDK subprocess test
    modal = None

from modelforge_workbench.modal_worker import (
    asset_by_id,
    result_envelope,
    validate_request,
    verified_asset,
)


APP_NAME = "modelforge-alpha-tastematch-inference"
FUNCTION_NAME = "run_tastematch_inference"
VOLUME_NAME = "modelforge-alpha-tastematch-inputs"
INPUT_ROOT = "/mnt/modelforge-inputs"
REMOTE_PROJECT_ROOT = "/opt/modelforge-example"
RESOURCE_PLAN = {
    "gpu": "L4",
    "cpu": 2.0,
    "memory": 16_384,
    "timeout": 900,
    "startup_timeout": 900,
    "retries": 0,
    "max_containers": 1,
    "min_containers": 0,
}

# The official Food-101 class vocabulary is metadata, not redistributed imagery.
FOOD101_CLASSES = (
    "apple_pie", "baby_back_ribs", "baklava", "beef_carpaccio", "beef_tartare",
    "beet_salad", "beignets", "bibimbap", "bread_pudding", "breakfast_burrito",
    "bruschetta", "caesar_salad", "cannoli", "caprese_salad", "carrot_cake",
    "ceviche", "cheesecake", "cheese_plate", "chicken_curry", "chicken_quesadilla",
    "chicken_wings", "chocolate_cake", "chocolate_mousse", "churros", "clam_chowder",
    "club_sandwich", "crab_cakes", "creme_brulee", "croque_madame", "cup_cakes",
    "deviled_eggs", "donuts", "dumplings", "edamame", "eggs_benedict", "escargots",
    "falafel", "filet_mignon", "fish_and_chips", "foie_gras", "french_fries",
    "french_onion_soup", "french_toast", "fried_calamari", "fried_rice", "frozen_yogurt",
    "garlic_bread", "gnocchi", "greek_salad", "grilled_cheese_sandwich", "grilled_salmon",
    "guacamole", "gyoza", "hamburger", "hot_and_sour_soup", "hot_dog", "huevos_rancheros",
    "hummus", "ice_cream", "lasagna", "lobster_bisque", "lobster_roll_sandwich",
    "macaroni_and_cheese", "macarons", "miso_soup", "mussels", "nachos", "omelette",
    "onion_rings", "oysters", "pad_thai", "paella", "pancakes", "panna_cotta",
    "peking_duck", "pho", "pizza", "pork_chop", "poutine", "prime_rib",
    "pulled_pork_sandwich", "ramen", "ravioli", "red_velvet_cake", "risotto", "samosa",
    "sashimi", "scallops", "seaweed_salad", "shrimp_and_grits", "spaghetti_bolognese",
    "spaghetti_carbonara", "spring_rolls", "steak", "strawberry_shortcake", "sushi",
    "tacos", "takoyaki", "tiramisu", "tuna_tartare", "waffles",
)


def _execute(payload: Mapping) -> dict:
    request = validate_request(
        payload,
        project_id="tastematch",
        action_id="inference",
        action_kind="inference",
    )
    action = request["request"]
    if action.get("workflow") != "inference" or action.get("action_id") != "inference":
        raise ValueError("TasteMatch Modal request is not the authored inference action")
    image_asset = asset_by_id(request, "selected-image")
    model_asset = asset_by_id(request, "siglip-model")
    if image_asset.get("sha256") != action.get("dataset_sample_sha256"):
        raise ValueError("TasteMatch request image differs from the staged input")
    image_path = verified_asset(INPUT_ROOT, image_asset, expected_role="input")
    model_path = verified_asset(INPUT_ROOT, model_asset, expected_role="model")
    image_bytes = image_path.read_bytes()

    project_root = Path(REMOTE_PROJECT_ROOT)
    sys.path.insert(0, str(project_root))
    from tastematch import MODEL_ID, MODEL_REVISION
    from tastematch.inference import image_media_type, load_pinned_pretrained

    media_type = image_media_type(image_bytes)
    try:
        import torch
        from PIL import Image
        from transformers import AutoModel, AutoProcessor
    except ImportError as exc:  # pragma: no cover - deployment image owns dependencies
        raise RuntimeError("TasteMatch Modal image is missing its pinned ML dependencies") from exc
    processor, model = load_pinned_pretrained(AutoProcessor, AutoModel, str(model_path))
    model = model.to("cuda:0").eval()
    picture = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    prompts = [f"a photo of {label.replace('_', ' ')}" for label in FOOD101_CLASSES]
    inputs = processor(
        text=prompts,
        images=picture,
        padding="max_length",
        return_tensors="pt",
    ).to("cuda:0")
    with torch.inference_mode():
        scores = model(**inputs).logits_per_image[0].float().sigmoid()
    values, indices = torch.topk(scores, k=5)
    top = [
        {
            "label": FOOD101_CLASSES[int(index)].replace("_", " "),
            "score": round(float(score), 6),
        }
        for score, index in zip(values.cpu(), indices.cpu(), strict=True)
    ]
    report = {
        "protocol": "tastematch.base-siglip-inference/v1",
        "evidence_mode": "pinned-base-siglip-no-adapter",
        "model_id": MODEL_ID,
        "model_revision": MODEL_REVISION,
        "input_sha256": hashlib.sha256(image_bytes).hexdigest(),
        "input_media_type": media_type,
        "top": top,
        "notice": "Base SigLIP similarity output; no TasteMatch adapter or accuracy claim.",
    }
    with tempfile.TemporaryDirectory(prefix="modelforge-tastematch-") as temporary:
        root = Path(temporary)
        report_path = root / "report.json"
        report_path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        result = {
            "format": "modelforge.inference-result/v1",
            "kind": "table",
            "input_artifact": {"sha256": image_asset["sha256"]},
            "model": {"id": MODEL_ID, "revision": MODEL_REVISION},
            "results": [{
                "role": "primary",
                "kind": "table",
                "path": report_path.name,
                "mime_type": "application/json",
                "sha256": hashlib.sha256(report_path.read_bytes()).hexdigest(),
            }],
        }
        result_path = root / "result.json"
        result_path.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        return result_envelope(request["run_id"], [result_path, report_path])


def run_tastematch_inference(request: Mapping) -> dict:
    return _execute(request)


if modal is not None:
    _project_root = Path(__file__).resolve().parent
    app = modal.App(APP_NAME)
    input_volume = modal.Volume.from_name(VOLUME_NAME, create_if_missing=False)
    image = (
        modal.Image.debian_slim(python_version="3.12")
        .pip_install(
            "accelerate==1.3.0",
            "Pillow==11.1.0",
            "safetensors==0.5.2",
            "torch==2.6.0",
            "transformers==4.48.3",
        )
        .add_local_python_source("modelforge_workbench", copy=True)
        .add_local_dir(str(_project_root), remote_path=REMOTE_PROJECT_ROOT, copy=True)
    )
    run_tastematch_inference = app.function(
        image=image,
        volumes={INPUT_ROOT: input_volume},
        **RESOURCE_PLAN,
    )(modal.concurrent(max_inputs=1)(run_tastematch_inference))
else:
    app = image = input_volume = None


__all__ = ["app", "run_tastematch_inference"]
