# SPDX-License-Identifier: Apache-2.0
"""Explicit eight-class MeMOTR to collapsed vehicle compatibility mapping."""

from __future__ import annotations


NATIVE_CLASSES = (
    "pedestrian",
    "rider",
    "car",
    "truck",
    "bus",
    "train",
    "motorcycle",
    "bicycle",
)
VEHICLE_CLASSES = frozenset(("car", "truck", "bus", "train", "motorcycle", "bicycle"))


def map_native_predictions(rows: list[dict]) -> list[dict]:
    """Filter compatible native classes without erasing their semantics."""
    mapped = []
    for row in rows:
        index = int(row["native_class_index"])
        if not 0 <= index < len(NATIVE_CLASSES):
            raise ValueError(f"Invalid MeMOTR native class index: {index}")
        native_class = NATIVE_CLASSES[index]
        declared = row.get("native_class", native_class)
        if declared != native_class:
            raise ValueError(f"Native class/index mismatch: {declared!r} != {native_class!r}")
        if native_class not in VEHICLE_CLASSES:
            continue
        mapped_row = dict(row)
        mapped_row["native_class"] = native_class
        mapped_row["target_class"] = "vehicle"
        mapped.append(mapped_row)
    return mapped
