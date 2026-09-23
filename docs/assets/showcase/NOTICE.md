# Showcase media attribution

These owner-requested documentation excerpts show actual ModelForge runs and
current user interface. They are demonstration media, not a dataset release or
a grant to use source datasets, model weights, or third-party visual material.

- BDD100K road scenes and derived tracking/annotation excerpts: BDD100K contributors.
  Dataset: https://www.bdd100k.com/ . The dataset terms are distinct from the
  toolkit software license. Model: MeMOTR, https://github.com/MCG-NJU/MeMOTR .
- SoccerNet match imagery and derived SNMOT-060 tracking excerpt: SoccerNet and
  the underlying match-footage rights holders. Dataset access/terms:
  https://www.soccer-net.org/ . Model: MOTR, https://github.com/megvii-research/MOTR .
- Weather visualization: project-generated WeatherBench2 / HURDAT2 diagnostic,
  using the recorded ERA5-derived inputs. Source projects/data:
  https://github.com/google-research/weatherbench2 and
  https://www.nhc.noaa.gov/data/ .
- ModelForge interface and product identity: Mathew Turnell / Modality Systems.

Framework code remains Apache-2.0. That license does not relicense the underlying
third-party imagery depicted in these excerpts. The source inventory labels
these media `LicenseRef-Showcase-Media` with this notice rather than assigning
the framework's Apache license to third-party footage. Obtain source data and
weights from their owners under their respective terms to reproduce the runs.

`manifest.json` records exact publication identities and links result clips to
their checked runs. The SoccerNet clip is a smaller H.264 publication encode;
BDD100K and Weather result bytes are unchanged. The workbench tour shows current
UI state; no obsolete-client recording is used in the README showcase.
