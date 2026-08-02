# NicheFoundry Visual System Schema 1.0

## Purpose

The Visual System Schema defines the design constitution, scene plan, asset ledger, thumbnail plan, and verification evidence used by NicheFoundry Phase 7.

## Studio Pack extension

Each Studio Pack includes a `visual_system` object.

```json
{
  "visual_system": {
    "name": "Failure Atlas Systems Cartography",
    "motif": "technical_cutaway",
    "texture": "engineering_grid",
    "icon_style": "outlined_technical",
    "diagram_style": "force_path",
    "map_style": "infrastructure_schematic",
    "compositions": [
      "cutaway_left",
      "load_path",
      "causal_stack",
      "investigation_board",
      "system_vs_failure",
      "design_principle"
    ],
    "thumbnail_compositions": [
      "fracture_focus",
      "system_vs_failure",
      "single_component_warning"
    ],
    "identity": {
      "colors": {
        "background": "#071016",
        "surface": "#111f29",
        "panel": "#172a35",
        "primary": "#dce8ee",
        "muted": "#8fa4af",
        "accent": "#45d5ff",
        "secondary": "#f2a93b",
        "danger": "#ed5a5a",
        "grid": "#223846"
      },
      "typography": {
        "display": "Rajdhani, Oxanium, sans-serif",
        "body": "Inter, Arial, sans-serif",
        "mono": "IBM Plex Mono, monospace"
      }
    },
    "grid": {
      "columns": 12,
      "gutter_px": 28,
      "margin_px": 96,
      "baseline_px": 8
    },
    "safe_area": {
      "title": 0.08,
      "action": 0.05,
      "captions_bottom": 0.16
    },
    "accessibility": {
      "minimum_body_px_1080p": 34,
      "minimum_caption_px_1080p": 42
    }
  }
}
```

## Required constitution rules

A valid visual constitution requires:

- at least four scene compositions
- at least two thumbnail compositions
- complete semantic colour roles
- valid hexadecimal colours
- adequate primary-text contrast
- display, body, and monospace font stacks
- a positive grid definition
- safe-area values between zero and one
- readable minimum text sizes

## Visual identity artifact

`visual_identity.json` contains the immutable resolved identity used for an episode.

Important fields:

```text
schema
studio_id
studio_name
identity_hash
motif
texture
icon_style
diagram_style
map_style
colors
typography
grid
safe_area
accessibility
rights_defaults
```

## Scene plan

`visual_plan.json` contains one entry per script scene.

Each scene plan includes:

```text
scene_id
scene_index
beat_name
kind
title
objective
composition
motion
transition
safe_area
evidence_overlay
source_ids
claim_ids
preview_asset_id
preview_path
```

The scene count must match the script package scene count.

## Asset manifest

`asset_manifest.json` is the operational asset inventory.

Each asset includes:

```text
asset_id
episode_id
scene_id
asset_type
media_type
relative_path
role
status
generated_by
generation_input_hash
creator
publisher
source_url
source_ids
claim_ids
licence
rights_status
synthetic
disclosure_required
width
height
size_bytes
sha256
replaces_asset_id
created_at
```

## Provenance ledger

`asset_provenance.json` records the origin and rights evidence independently from the render manifest. It must remain reviewable even when an asset is later superseded.

## Hash manifest

`visual_asset_hashes.json` contains:

```text
schema
episode_id
complete
assets[].asset_id
assets[].relative_path
assets[].exists
assets[].size_bytes
assets[].sha256
generated_at
```

The evidence engine recomputes every file hash. A manifest cannot verify itself.

## Thumbnail plan

`thumbnail_plan.json` stores multiple candidates, one selected candidate, its selection reason, contrast metrics, visible word count, composition, and prohibited practices.

A candidate is blocked when:

- visible headline text exceeds seven words
- contrast is below 4.5:1
- it promises imagery or events the episode does not deliver
- it relies on unlicensed likeness or source material

## Similarity report

`visual_similarity_report.json` records:

```text
maximum_library_similarity
closest_library_matches
composition_counts
largest_composition_share
unique_compositions
issues
warnings
```

Default thresholds:

```text
70%  warning
84%  block
50%  maximum share for one scene composition
```

## Visual report

`visual_report.json` is the final Phase 7 gate.

Required gates:

```text
visual_identity
scene_coverage
rights_and_provenance
anti_template_similarity
thumbnail_legibility
```

The report passes only when all gates pass and no blocking issue remains.
