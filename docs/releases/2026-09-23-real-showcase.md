# Put real ModelForge work on the public product page

The README presented synthetic browser-test fixtures while the actual BDD100K,
SoccerNet and Weather reproductions remained in a local evidence gallery. That
made the published product page fail to demonstrate the work requested.

The README now shows the current React/MUI interface with the real BDD100K
annotation sequence, checkpoint-bound MeMOTR architecture, recorded box-head
training curves and checked inference playback. SoccerNet and Weather captures
show their completed real runs. Eight full-resolution screenshots, three result
videos and a short MUI workbench tour are published with exact file hashes and
run identities in [the showcase record](../showcase.md).

The videos are existing checked reproduction outputs, not new compute launched
for this documentation fix. The SoccerNet publication copy is a smaller encode
of the same 125 frames; its source and publication hashes are both recorded.
BDD100K and Weather clips retain their checked output bytes. No fixture scores
or synthetic media are used as the README’s product showcase. Synthetic fixtures
remain labelled in the installation tutorial and automated browser tests.

Captures are reviewed for readable settled media, correct MUI presentation, and
absence of credentials/private filesystem paths. The explicit publication file
list and source manifest are updated. Showcase media stays in the repository’s
documentation and is excluded from the installed Python package and sdist.
No runtime behavior or scientific evidence is changed by this correction.

Full historical feature parity remains unproven. The showcase record retains
precise training, inference, assistant, Modal, annotation and Weather-viewer
limits rather than presenting screenshots as evidence of unsupported features.
