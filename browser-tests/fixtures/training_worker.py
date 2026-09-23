"""Optimize one scalar on authored splits; no provider, model download, or GPU."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--request', type=Path, required=True)
parser.add_argument('--train', type=Path, required=True)
parser.add_argument('--validation', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
request = json.loads(args.request.read_text())
training_target = json.loads(args.train.read_text())['target']
validation_target = json.loads(args.validation.read_text())['target']
weight = 0.0
telemetry = args.output / 'telemetry.jsonl'
with telemetry.open('w') as stream:
    for step in range(request['max_batches']):
        loss = (weight - training_target) ** 2
        weight -= request['learning_rate'] * 2 * (weight - training_target)
        print(f'Optimizer step {step}: train loss {loss}', flush=True)
        for split, value in [('train', loss), ('validation', (weight - validation_target) ** 2)]:
            event = dict(protocol='modelforge.training-scalar/v1', step=step, split=split, name='loss', value=value)
            stream.write(json.dumps(event) + '\n')
        stream.flush()
checkpoint = args.output / 'candidate.json'
checkpoint.write_text(json.dumps({'weight': weight, 'quality_claim': False}))
def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()
result = dict(
    protocol='modelforge.training-result/v1', candidate_status='unpromoted',
    provenance={key: request.get(key) for key in ['dataset_sample_sha256', 'validation_sample_sha256', 'checkpoint_sha256']},
    results=[dict(kind='checkpoint', path=checkpoint.name, sha256=digest(checkpoint), mime_type='application/json')],
    telemetry=dict(path=telemetry.name, sha256=digest(telemetry)),
)
(args.output / 'result.json').write_text(json.dumps(result))
