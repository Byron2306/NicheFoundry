# NicheFoundry Connector Schema 1.0

## Purpose

A connector is a declarative contract that tells NicheFoundry:

- what a source integration is called
- which approved runtime adapter executes it
- which capabilities it may provide
- which environment variable names it requires
- what source tier and source type its records receive by default
- whether it may satisfy a primary-source requirement
- what request and item limits govern it

A connector definition never contains secret values and never uploads arbitrary JavaScript.

## Top-level structure

```json
{
  "schema": "nichefoundry.connector.v1",
  "connector": {
    "id": "my_specialist_feed",
    "name": "My Specialist Feed",
    "version": "1.0.0",
    "adapter": "rss",
    "description": "Reads one approved specialist feed.",
    "capabilities": ["topic_discovery", "research_leads"],
    "auth": { "type": "none", "env": [] },
    "default_source_tier": 3,
    "default_source_type": "feed_synopsis",
    "default_config": {},
    "limits": {},
    "trust": {
      "can_satisfy_primary_source": false,
      "content_completeness": "synopsis",
      "notes": "Feed records are leads, not finished factual evidence."
    }
  }
}
```

## Required fields

### `schema`

Must equal `nichefoundry.connector.v1`.

### `connector.id`

A stable lowercase identifier using letters, digits, underscores, or hyphens. Built-in IDs cannot be replaced by custom definitions.

### `connector.version`

Semantic version in `major.minor.patch` form.

### `connector.adapter`

Phase 4 accepts only guarded built-in adapters:

- `mediawiki`
- `curated_packet`
- `rss`
- `youtube_public`
- `youtube_analytics`
- `github_releases`
- `web_document`

A new adapter type requires a reviewed code change, tests, documentation, and release packaging. Custom definitions may configure approved adapters but cannot introduce executable code.

### `connector.capabilities`

One or more declared capabilities. Common values include:

- `research_sources`
- `research_leads`
- `topic_discovery`
- `competitor_evidence`
- `market_signals`
- `freshness_evidence`
- `owned_analytics`
- `learning_loop`

The runtime checks capability boundaries before a connector may enter a research plan or opportunity workflow.

### `connector.auth`

```json
{
  "type": "api_key",
  "env": ["YOUTUBE_API_KEY"]
}
```

`env` contains variable names only. Secret values remain in `.env`, the process environment, or a future operating-system keyring.

Supported policy labels:

- `none`
- `api_key`
- `oauth2_refresh_token`
- `optional_token`
- `optional_headers`

### `connector.default_source_tier`

NicheFoundry uses four evidence tiers:

1. Primary or authoritative first-party evidence
2. Peer-reviewed, institutional, or expert secondary evidence
3. Reputable orientation or discovery material
4. Platform metadata, analytics, or low-authority contextual signals

Tier 4 market signals may guide topic decisions but may not silently become factual script evidence.

### `connector.trust`

Every connector must explicitly declare whether it can satisfy a primary-source requirement. This is a policy ceiling, not an automatic promotion. Individual records still carry their own tier, source type, and primary-source flag.

## Run output

Every execution returns `nichefoundry.connector_run.v1`:

```json
{
  "schema": "nichefoundry.connector_run.v1",
  "run_id": "connector_run_...",
  "connector_id": "rss_monitor",
  "status": "completed",
  "input": { "feed_urls": ["https://example.org/feed.xml"] },
  "sources": [],
  "candidates": [],
  "analytics": [],
  "records": [],
  "usage": {},
  "warnings": [],
  "error": null,
  "started_at": "...",
  "finished_at": "..."
}
```

Sensitive-looking fields such as tokens, secrets, passwords, authorization headers, and API keys are redacted before the run is persisted.

## Security rules

- Web and RSS targets require HTTPS.
- Web and RSS targets require an explicit hostname allowlist.
- Localhost, private IP ranges, link-local targets, and private DNS resolutions are blocked.
- Redirect destinations are revalidated.
- Response size, timeout, item count, and retry limits are bounded.
- Custom connector files are written with owner-only permissions where supported.
- Connector definitions cannot replace built-in IDs.
- Unknown adapter names fail validation.
