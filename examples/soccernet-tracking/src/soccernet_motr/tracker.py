from __future__ import annotations

import math
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from PIL import Image


@dataclass
class Detection:
    x: float
    y: float
    width: float
    height: float
    color: tuple[int, int, int]
    score: float = 1.0

    @property
    def center(self) -> tuple[float, float]:
        return self.x + self.width / 2, self.y + self.height / 2


@dataclass
class TrackQuery:
    track_id: int
    detection: Detection
    velocity_x: float = 0.0
    velocity_y: float = 0.0
    missed: int = 0


def color_distance(left: tuple[int, int, int], right: tuple[int, int, int]) -> float:
    return math.sqrt(sum((a - b) ** 2 for a, b in zip(left, right)))


def median_color(image: "Image.Image", box: tuple[float, float, float, float]) -> tuple[int, int, int]:
    x, y, width, height = box
    crop = image.crop((int(x) + 2, int(y) + 2, int(x + width) - 2, int(y + height) - 2)).convert("RGB")
    pixels = list(crop.get_flattened_data())
    if not pixels:
        return (0, 0, 0)
    return tuple(sorted(pixel[channel] for pixel in pixels)[len(pixels) // 2] for channel in range(3))


def detect_components(image_path: Path, prototypes: list[tuple[int, int, int]], threshold: float) -> list[Detection]:
    from PIL import Image

    image = Image.open(image_path).convert("RGB")
    width, height = image.size
    pixels = image.load()
    mask: set[tuple[int, int]] = set()
    for y in range(height):
        for x in range(width):
            color = pixels[x, y]
            if min((color_distance(color, prototype) for prototype in prototypes), default=999) <= threshold:
                mask.add((x, y))
    detections: list[Detection] = []
    while mask:
        seed = mask.pop()
        stack = [seed]
        points = [seed]
        while stack:
            x, y = stack.pop()
            for neighbor in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                if neighbor in mask:
                    mask.remove(neighbor)
                    stack.append(neighbor)
                    points.append(neighbor)
        if len(points) < 8:
            continue
        xs, ys = [p[0] for p in points], [p[1] for p in points]
        colors = [pixels[x, y] for x, y in points]
        mean = tuple(int(sum(value[channel] for value in colors) / len(colors)) for channel in range(3))
        detections.append(Detection(min(xs), min(ys), max(xs) - min(xs) + 1, max(ys) - min(ys) + 1, mean, 0.99))
    return sorted(detections, key=lambda item: (item.x, item.y))


class SmokeTrackQueryModel:
    """Small deterministic track-query lifecycle used only to test project plumbing.

    It intentionally is not the published neural MOTR architecture. Active object
    states are propagated frame-to-frame as track queries, which exercises the same
    temporal input/output contract without PyTorch or CUDA.
    """

    def __init__(self, prototypes: list[tuple[int, int, int]], threshold: float = 38.0):
        self.prototypes = prototypes
        self.threshold = threshold
        self.queries: list[TrackQuery] = []
        self.next_id = 1

    def update(self, detections: list[Detection]) -> list[TrackQuery]:
        candidates: list[tuple[float, int, int]] = []
        for query_index, query in enumerate(self.queries):
            old_x, old_y = query.detection.center
            predicted = old_x + query.velocity_x, old_y + query.velocity_y
            for detection_index, detection in enumerate(detections):
                new_x, new_y = detection.center
                spatial = math.dist(predicted, (new_x, new_y))
                appearance = color_distance(query.detection.color, detection.color) * 0.25
                candidates.append((spatial + appearance, query_index, detection_index))
        used_queries: set[int] = set()
        used_detections: set[int] = set()
        for cost, query_index, detection_index in sorted(candidates):
            if cost > 35 or query_index in used_queries or detection_index in used_detections:
                continue
            query = self.queries[query_index]
            old_x, old_y = query.detection.center
            new_x, new_y = detections[detection_index].center
            query.velocity_x, query.velocity_y = new_x - old_x, new_y - old_y
            query.detection = detections[detection_index]
            query.missed = 0
            used_queries.add(query_index)
            used_detections.add(detection_index)
        for index, query in enumerate(self.queries):
            if index not in used_queries:
                query.missed += 1
        self.queries = [query for query in self.queries if query.missed <= 2]
        for index, detection in enumerate(detections):
            if index not in used_detections:
                self.queries.append(TrackQuery(self.next_id, detection))
                self.next_id += 1
        return [query for query in self.queries if query.missed == 0]

    def public_state(self) -> list[dict]:
        return [{**asdict(query), "detection": asdict(query.detection)} for query in self.queries]
