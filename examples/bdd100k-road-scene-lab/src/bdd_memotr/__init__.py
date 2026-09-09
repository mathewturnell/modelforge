# SPDX-License-Identifier: Apache-2.0
"""Project adapter for the pinned official MeMOTR BDD100K checkpoint."""

from .contract import load_contract, validate_contract
from .mapping import NATIVE_CLASSES, VEHICLE_CLASSES, map_native_predictions

__all__ = [
    "NATIVE_CLASSES",
    "VEHICLE_CLASSES",
    "load_contract",
    "map_native_predictions",
    "validate_contract",
]
