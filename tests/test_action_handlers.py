from __future__ import annotations

import pytest

from modelforge_workbench.application.action_handlers import action_handler


@pytest.mark.parametrize(
    ("kind", "request_value", "protocol", "result"),
    (
        (
            "training",
            {"workflow": "training", "action_id": "fit", "dataset_split": "train"},
            "example.training/v1",
            {"protocol": "example.training/v1", "checkpoint": "candidate.pt"},
        ),
        (
            "evaluation",
            {
                "workflow": "evaluation", "action_id": "score", "split": "test",
                "checkpoint_sha256": "a" * 64,
            },
            "example.evaluation/v1",
            {"protocol": "example.evaluation/v1", "metrics": {"score": 0.5}},
        ),
        (
            "inference",
            {"workflow": "inference", "action_id": "predict"},
            "modelforge.inference-result/v1",
            {
                "format": "modelforge.inference-result/v1",
                "kind": "video",
                "results": [{"path": "result.mp4", "sha256": "a" * 64}],
            },
        ),
        (
            "prompt",
            {"workflow": "prompt", "action_id": "chat"},
            "modelforge.prompt-result/v1",
            {
                "protocol": "modelforge.prompt-result/v1",
                "messages": [{"role": "assistant", "content": "ready"}],
            },
        ),
        (
            "dataset",
            {"workflow": "dataset_transformation", "action_id": "prepare"},
            "modelforge.dataset-build/v1",
            {"protocol": "modelforge.dataset-build/v1", "dataset_ref": "owned-fixture"},
        ),
    ),
)
def test_standard_handlers_validate_distinct_request_and_result_shapes(
    kind, request_value, protocol, result,
):
    handler = action_handler(kind)

    assert handler.validate_request(request_value).detached() == request_value
    assert handler.validate_result(result, expected_protocol=protocol).detached() == result


@pytest.mark.parametrize("split", ("test", "reserved-test", "held_out"))
def test_training_rejects_reserved_evaluation_splits(split):
    with pytest.raises(ValueError, match="reserved test split"):
        action_handler("training").validate_request({
            "workflow": "training", "action_id": "fit", "evaluation_split": split,
        })


@pytest.mark.parametrize("field", ("promote", "promotion", "self_promote", "promoted_checkpoint"))
def test_training_rejects_self_promotion(field):
    with pytest.raises(ValueError, match="cannot promote"):
        action_handler("training").validate_request({
            "workflow": "training", "action_id": "fit", field: True,
        })


def test_prompt_does_not_require_dataset_or_checkpoint_and_requires_assistant_result():
    handler = action_handler("prompt")
    handler.validate_request({"workflow": "prompt", "action_id": "chat"})
    with pytest.raises(ValueError, match="assistant message"):
        handler.validate_result(
            {"protocol": "modelforge.prompt-result/v1", "messages": []},
            expected_protocol="modelforge.prompt-result/v1",
        )


@pytest.mark.parametrize(
    "result",
    (
        {"format": "modelforge.inference-result/v1"},
        {"format": "modelforge.inference-result/v1", "results": []},
    ),
)
def test_inference_result_requires_a_valid_artifact(result):
    with pytest.raises(ValueError, match="artifact"):
        action_handler("inference").validate_result(
            result, expected_protocol="modelforge.inference-result/v1",
        )


@pytest.mark.parametrize(
    "messages",
    (
        [{"role": "assistant", "content": ""}],
        [{"role": "assistant", "content": "   "}],
        [{"role": "assistant", "content": "ok"}, "junk"],
        [{"role": "assistant", "content": "ok"}, {"role": "tool", "content": "junk"}],
        [{"role": "user", "content": "echoed prompt"}, {"role": "assistant", "content": "ok"}],
        [{"role": "system", "content": "echoed policy"}, {"role": "assistant", "content": "ok"}],
    ),
)
def test_prompt_result_rejects_empty_or_malformed_messages(messages):
    with pytest.raises(ValueError, match="Prompt result"):
        action_handler("prompt").validate_result(
            {"protocol": "modelforge.prompt-result/v1", "messages": messages},
            expected_protocol="modelforge.prompt-result/v1",
        )


def test_evaluation_requires_split_and_candidate_identity():
    handler = action_handler("evaluation")
    with pytest.raises(ValueError, match="explicit split"):
        handler.validate_request({"workflow": "evaluation", "action_id": "score"})
    with pytest.raises(ValueError, match="candidate identity"):
        handler.validate_request({
            "workflow": "evaluation", "action_id": "score", "split": "validation",
        })


def test_wrong_kind_or_protocol_is_rejected_without_runtime_inference():
    handler = action_handler("inference")
    with pytest.raises(ValueError, match="not a inference action"):
        handler.validate_request({"workflow": "training", "action_id": "predict"})
    with pytest.raises(ValueError, match="protocol must be"):
        handler.validate_result(
            {"format": "future/v2", "kind": "video"},
            expected_protocol="modelforge.inference-result/v1",
        )
    with pytest.raises(ValueError, match="unsupported"):
        action_handler("future")
