"""Bounded scientific scalar evidence; values are observations, never quality claims."""

from __future__ import annotations

import json
import math
import re
from pathlib import Path
from typing import Mapping

PROTOCOL = "modelforge.training-scalar/v1"
MAX_BYTES = 2 * 1024 * 1024
MAX_EVENTS = 10000
_NAME = re.compile(r"^[A-Za-z][A-Za-z0-9_. /-]{0,79}$")


def validate_training_parameters(value: Mapping) -> dict:
    allowed = {"device", "epochs", "max_batches", "learning_rate", "seed"}
    if set(value) - allowed:
        raise ValueError("Training parameters contain unsupported fields")
    result = {"device": "cpu", "epochs": 1, "max_batches": 10, "learning_rate": 0.001, "seed": 0, **value}
    for name, lower, upper in (("epochs", 1, 100), ("max_batches", 1, 10000), ("seed", 0, 2147483647)):
        number = result[name]
        if isinstance(number, bool) or not isinstance(number, int) or not lower <= number <= upper:
            raise ValueError(f"Training {name} is outside its bounded range")
    rate = result["learning_rate"]
    if isinstance(rate, bool) or not isinstance(rate, (float, int)) or not math.isfinite(rate) or not 0 < rate <= 1:
        raise ValueError("Training learning_rate must be finite and between zero and one")
    if not isinstance(result["device"], str) or result["device"] not in {"cpu", "cuda", "cuda:0", "auto"}:
        raise ValueError("Training device is unsupported")
    return result


def validate_training_scalar(value: Mapping) -> dict:
    """Validate one detached scalar from a local file or live provider log."""
    event = dict(value) if isinstance(value, Mapping) else value
    if not isinstance(event, dict) or set(event) != {"protocol", "step", "split", "name", "value"}:
        raise ValueError("Training telemetry event fields are invalid")
    step, number = event["step"], event["value"]
    if (
        event["protocol"] != PROTOCOL
        or not isinstance(event["split"], str)
        or event["split"] not in {"train", "validation"}
    ):
        raise ValueError("Training telemetry protocol or split is invalid")
    if not isinstance(event["name"], str) or not _NAME.fullmatch(event["name"]):
        raise ValueError("Training metric name is invalid")
    if isinstance(step, bool) or not isinstance(step, int) or step < 0:
        raise ValueError("Training metric step is invalid")
    if (
        isinstance(number, bool)
        or not isinstance(number, (int, float))
        or not (-1.7976931348623157e308 <= number <= 1.7976931348623157e308)
    ):
        raise ValueError("Training metric value must be finite")
    return event


def read_training_telemetry(path: Path, *, complete: bool = False) -> dict:
    """Read complete JSONL events, ignoring only a final partially written line."""
    if not path.exists():
        return {"status": "unavailable", "events": [], "reason": "No scientific telemetry has been emitted"}
    if path.is_symlink() or not path.is_file() or path.stat().st_size > MAX_BYTES:
        raise ValueError("Training telemetry must be a bounded regular file")
    data = path.read_bytes()
    if len(data) > MAX_BYTES:
        raise ValueError("Training telemetry exceeds its byte bound")
    lines = data.splitlines(keepends=True)
    if not complete and lines and not lines[-1].endswith(b"\n"):
        lines.pop()
    if len(lines) > MAX_EVENTS:
        raise ValueError("Training telemetry exceeds its event bound")
    events = []
    previous = {}
    for line in lines:
        event = json.loads(line)
        event = validate_training_scalar(event)
        step = event["step"]
        key = event["split"], event["name"]
        if step <= previous.get(key, -1):
            raise ValueError("Training metric steps must increase for each series")
        previous[key] = step
        events.append(event)
    return {"status": "available" if events else "unavailable", "events": events}
