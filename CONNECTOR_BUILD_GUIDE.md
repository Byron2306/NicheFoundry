# Building NicheFoundry Connectors

## The connector model

A connector has two layers:

1. **Definition**: a JSON file that configures an approved adapter.
2. **Adapter**: reviewed runtime code that talks to a specific protocol or API and normalises its output.

Most new integrations should begin as a definition using an existing adapter. Add runtime code only when the protocol genuinely cannot be represented by an existing adapter.

## Fast path: configure an existing adapter

### 1. Choose the job

Decide whether the connector supplies:

- factual research sources
- research leads
- topic discovery candidates
- competitor evidence
- freshness evidence
- owned-channel analytics

Do not mix these casually. YouTube views are valuable market evidence, but they are not evidence that a bridge failed for a particular technical reason.

### 2. Choose the trust ceiling

Determine:

- default source tier
- source type
- whether the connector can ever satisfy a primary-source gate
- whether returned text is complete enough for claim extraction

A feed synopsis should normally set `eligible_for_claims: false`. A government investigation report may qualify as primary evidence.

### 3. Create a definition

Use the dashboard's **Load RSS Template** button or place a JSON file in:

```text
connectors/custom/
```

Example RSS connector:

```json
{
  "schema": "nichefoundry.connector.v1",
  "connector": {
    "id": "engineering_board_feed",
    "name": "Engineering Board Feed",
    "version": "1.0.0",
    "adapter": "rss",
    "description": "Monitors the approved engineering board feed.",
    "capabilities": ["topic_discovery", "research_leads"],
    "auth": { "type": "none", "env": [] },
    "default_source_tier": 3,
    "default_source_type": "feed_synopsis",
    "default_config": {
      "feed_urls": ["https://board.example.org/feed.xml"],
      "allowed_hosts": ["board.example.org"],
      "max_items_per_feed": 20
    },
    "limits": {
      "max_items": 100,
      "timeout_ms": 15000,
      "attempts": 2,
      "max_bytes": 2000000
    },
    "trust": {
      "can_satisfy_primary_source": false,
      "content_completeness": "synopsis",
      "notes": "The feed identifies leads. Full documents must be retrieved separately."
    }
  }
}
```

### 4. Validate and install

Through the dashboard:

1. Open **Connector Bay and Evidence Graph**.
2. Paste the definition into **Custom Connector Definition**.
3. Select **Validate Connector**.
4. Review the content hash and any errors.
5. Select **Install Valid Connector**.

Through the API:

```bash
curl -sS -X POST http://127.0.0.1:4173/api/connectors/validate \
  -H 'Content-Type: application/json' \
  --data-binary @my_connector.json
```

Then install with `/api/connectors/install`.

### 5. Test with harmless inputs

Use **Test Connector** before attaching it to a production brief. Inspect:

- run status
- redacted input
- sources
- candidates
- analytics
- warnings
- usage
- persisted run history

### 6. Attach it to a brief

Set:

```json
{
  "research_connector_ids": ["mediawiki_research", "engineering_reports"],
  "connector_inputs": {
    "engineering_reports": {
      "urls": ["https://agency.example/report.html"],
      "allowed_hosts": ["agency.example"],
      "source_tier": 1,
      "primary_source": true
    }
  }
}
```

The connector plan, run output, sources, source hierarchy, freshness report, and conflict graph become approval-bound episode artifacts.

## Built-in connector recipes

### MediaWiki research

No credentials are required.

```json
{
  "topic": "Tacoma Narrows Bridge",
  "queries": ["Tacoma Narrows Bridge", "aeroelastic flutter"]
}
```

Use it for orientation and terminology. It does not satisfy primary-source requirements in specialist studios.

### Curated evidence packet

Use this for sources already obtained through a library, archive, manual download, or connector that is not yet automated.

```json
{
  "sources": [
    {
      "title": "Official investigation report",
      "source_url": "https://agency.example/report",
      "publisher": "Agency Name",
      "published_at": "2026-07-01T00:00:00Z",
      "source_tier": 1,
      "source_type": "official_investigation_report",
      "primary_source": true,
      "licence": "Public record; reuse review required",
      "extract": "The relevant complete passage goes here."
    }
  ]
}
```

### Allowlisted web document

Use only for explicitly approved public HTTPS pages.

```json
{
  "urls": ["https://museum.example/object/123"],
  "allowed_hosts": ["museum.example"],
  "publisher_by_host": { "museum.example": "Museum Name" },
  "source_tier": 1,
  "source_type": "official_collection_record",
  "primary_source": true,
  "licence": "Review required"
}
```

### GitHub releases

```json
{
  "repositories": ["ollama/ollama", "ggerganov/llama.cpp"],
  "per_page": 10
}
```

The connector retrieves official repository metadata and published release records. Add `GITHUB_TOKEN` to `.env` when authenticated access or higher limits are needed.

### YouTube public discovery

1. Create a Google Cloud project.
2. Enable the YouTube Data API v3.
3. Create an API key and restrict it appropriately.
4. Add it to the private `.env` file:

```text
YOUTUBE_API_KEY=...
```

Run input:

```json
{
  "query": "engineering failure documentary",
  "region_code": "ZA",
  "relevance_language": "en",
  "max_results": 10,
  "published_after_days": 730
}
```

The adapter calls public search, then enriches returned video IDs with current snippet, statistics, and duration data. It produces opportunity candidates and competitor evidence, not script sources.

### YouTube owned-channel analytics

1. Create a Google Cloud project.
2. Enable the YouTube Data API v3 and YouTube Analytics API.
3. Create an OAuth client for a desktop application.
4. Place the client values in `.env`:

```text
YOUTUBE_CLIENT_ID=...
YOUTUBE_CLIENT_SECRET=...
```

5. Run:

```bash
npm run setup:youtube-oauth
```

6. Complete the browser consent flow.
7. Copy the returned `YOUTUBE_REFRESH_TOKEN` into `.env`.
8. Run `npm run check:connectors`.

The bootstrap requests read-only YouTube account and analytics scopes. The runtime stores the refresh token only in the operator's private environment and exchanges it for short-lived access tokens when a report is requested.

Default analytics input:

```json
{
  "lookback_days": 90,
  "metrics": ["views", "estimatedMinutesWatched", "averageViewDuration", "subscribersGained"],
  "dimensions": ["video"],
  "max_results": 200
}
```

## Adding a new adapter type

A new adapter belongs in `lib/connectors.js` only after the following work is complete:

1. Define the capability and trust boundary.
2. Specify the remote API or protocol and official authentication method.
3. Add strict input validation.
4. Add timeouts, retries, item limits, and response-size limits.
5. Add allowlisting and SSRF controls for operator-supplied URLs.
6. Normalise outputs into sources, candidates, analytics, or records.
7. Redact sensitive inputs before persistence.
8. Add mocked primary-source tests for success and failure cases.
9. Add database persistence tests.
10. Add dashboard defaults and documentation.
11. Add the adapter name to the validation allowlist only after review.

The runtime deliberately refuses arbitrary connector code uploaded through the dashboard. This prevents a convenient integration feature from becoming remote code execution wearing a charming name badge.
