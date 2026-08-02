# Phase 7 Implementation Ledger

## Objective

Phase 7 implements the Visual Language and Asset System. It converts an approved Studio Pack, audience strategy, evidence ledger, and structured story into a studio-native visual production package whose assets can be independently verified and legally reviewed.

## Implemented components

### Visual system engine

`lib/visual_system.js` supplies:

- Studio Pack visual-constitution validation
- deterministic visual identity construction
- colour and typography contracts
- grid, safe-area, and accessibility rules
- studio-specific scene composition selection
- evidence-overlay planning
- scene motion and transition cues
- thumbnail candidate generation
- real SVG scene and thumbnail rendering
- asset-manifest and provenance construction
- package fingerprints and library similarity checks
- composition-diversity analysis
- external asset-record validation

### Specialist visual identities

The built-in pilots use materially different visual grammar:

- Failure Atlas uses technical cutaways, force paths, causal stacks, system-versus-failure comparisons, and investigation boards.
- History Under Glass uses object vitrines, exhibit labels, material studies, archival texture, chronology, and interpretation frames.
- Practical Open Source uses terminal states, architecture maps, reproducibility checks, command-result sequences, and version evidence.
- Puzzle Planet uses expedition routes, mission maps, progress indicators, challenge encounters, and educational payoff frames.

The renderer varies composition across scenes and blocks packages where one composition dominates more than half the programme.

### Real generated preview assets

For each episode, Phase 7 writes:

```text
visuals/scenes/<scene_id>.svg
visuals/thumbnail.svg
```

Scene previews are 1920×1080. Thumbnail previews are 1280×720. Every file is hashed after writing and independently rechecked by the evidence engine.

Generated previews clearly identify themselves as deterministic storyboard assets rather than authentic event imagery or final external media.

### Asset provenance and rights

Every asset records:

- asset ID
- episode and scene ID
- role and media type
- relative path
- generator, creator, or publisher
- generation-input hash
- source and claim bindings
- licence
- rights status
- synthetic status
- disclosure requirement
- file size and SHA-256
- replacement relationship

Unknown or uncleared rights block the visual gate.

### Controlled visual replacement

The API accepts registered replacements only when:

- the file is inside `imports/visuals/`
- the extension is SVG, PNG, JPEG, or WebP
- the file exists inside the episode directory
- the record includes an explicit licence and rights state
- an external creator or publisher is identified where required

Registering a replacement:

- hashes the file
- updates the manifest and provenance ledger
- marks the previous asset as superseded when applicable
- updates visual QA
- refreshes the approval bundle
- invalidates any prior human approval

### Secure visual preview

`GET /api/visual-assets/file` serves only files already registered in the selected episode's asset manifest. It rejects:

- paths outside `visuals/` or `imports/visuals/`
- traversal attempts
- unregistered files
- unsupported media types

The response carries restrictive security headers and private caching.

### Anti-template controls

Visual packages are fingerprinted using:

- studio identity
- motif and texture
- scene compositions
- motion rules
- thumbnail grammar
- topic and archetype

The system reports the closest prior packages, warns at 70% overlap, and blocks at 84% overlap. It separately blocks composition monoculture.

### Persistence

The SQLite schema now contains:

```text
visual_packages
visual_assets
```

It stores visual identities, packages, fingerprints, pass state, and asset ledgers independently from the episode JSON.

### Approval evidence

The following artifacts are written, verified, and added to the immutable approval bundle:

```text
visual_identity.json
visual_plan.json
asset_manifest.json
asset_provenance.json
visual_asset_hashes.json
thumbnail_plan.json
visual_similarity_report.json
visual_report.json
```

Phase 7 also fixed an approval-stability defect: rerunning integrations no longer regenerates identical visual hashes or invalidates an unchanged approved editorial packet.

### Dashboard

The Visual Foundry displays:

- palette and identity tokens
- scene storyboard previews
- thumbnail preview
- visual QA gate
- anti-template report
- asset provenance and rights
- controlled replacement registration

### Production compatibility

`scripts/build_cards.js` now recognises Phase 7 visual manifests and consumes the studio-native generated scene SVGs rather than falling back to the legacy worksheet-card renderer.

## Tests

Phase 7 adds eight tests covering:

- valid visual constitutions for all built-in studios
- four materially different scene and thumbnail grammars
- real SVG creation and independent hash verification
- anti-template and composition-monoculture blocking
- rights and attribution rejection
- SQLite package and asset persistence
- Visual Foundry DOM integrity
- live HTTP generation, guarded preview, traversal blocking, replacement registration, and approval invalidation

The complete Phase 0 through Phase 7 suite contains 47 tests.

## Honest boundary

Phase 7 generates deterministic storyboards, thumbnail previews, production contracts, and provenance evidence. It does not claim these SVGs are final illustrations or authentic source imagery.

Final image generation or acquisition, archival restoration, screen recording, map rendering from geographic data, animation, compositing, and polished video output remain downstream production work and must preserve the same rights, source, and approval gates.
