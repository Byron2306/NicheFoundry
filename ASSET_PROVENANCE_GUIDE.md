# Asset Provenance and Replacement Guide

## Why this exists

A polished video can still become unusable when the origin or commercial rights of one image cannot be proven. NicheFoundry therefore treats provenance as production data rather than a note added after rendering.

## Generated assets

Assets created by the deterministic Phase 7 renderer use:

```text
generated_by: nichefoundry_deterministic_svg_renderer
licence: project_owned_generated_asset
rights_status: cleared
synthetic: true
```

They are production previews and do not imitate authentic news, archival, or documentary evidence.

## External or edited assets

Before registration, record:

- exact file path
- creator or publisher
- licence or commissioning basis
- rights status
- original source URL when applicable
- whether the file is synthetic
- whether disclosure is required
- linked source and claim IDs
- the generated asset it replaces

## Allowed location

Place imported files inside:

```text
episodes/<episode_id>/imports/visuals/
```

The registration API will reject files elsewhere.

## Supported formats

```text
.svg
.png
.jpg
.jpeg
.webp
```

## Registration example

```json
{
  "episode_id": "episode_123",
  "scene_id": "scene_03",
  "relative_path": "imports/visuals/scene_03_museum_photo.jpg",
  "creator": "Example Museum",
  "publisher": "Example Museum Digital Archive",
  "source_url": "https://museum.example/object/123",
  "licence": "CC BY 4.0",
  "rights_status": "cleared",
  "synthetic": false,
  "disclosure_required": false,
  "source_ids": ["source_12"],
  "claim_ids": ["claim_31"],
  "replaces_asset_id": "asset_generated_scene_03"
}
```

## Dashboard workflow

1. Copy the asset into `imports/visuals/`.
2. Open the episode in the Visual Foundry.
3. Enter the relative path, scene, creator, licence, and replacement asset ID.
4. Run **Validate Rights Record**.
5. Run **Register Replacement**.
6. Review the updated provenance and visual report.
7. Reapprove the changed editorial bundle.

## Rights statuses

Recommended values:

- `cleared`: evidence supports intended commercial use
- `restricted`: use depends on a condition not yet satisfied
- `unknown`: rights have not been established
- `rejected`: asset may not be used

Only cleared assets pass the Phase 7 rights gate.

## Synthetic media

Set `synthetic: true` for generated or materially synthetic media. Set `disclosure_required: true` when realistic synthetic media could reasonably be mistaken for authentic people, places, events, documents, or recordings.

## Replacement behaviour

When `replaces_asset_id` is supplied:

- the old asset remains in the ledger
- its status becomes `superseded`
- the new file receives its own SHA-256
- visual QA is recalculated
- the approval bundle changes
- previous approval becomes invalid

This preserves a complete editorial chain instead of erasing history with a prettier file.
