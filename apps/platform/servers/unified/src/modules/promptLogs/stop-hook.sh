#!/usr/bin/env bash
# Called by the Stop hook. stdin = JSON payload from Claude Code.
# Reads the transcript file, extracts the last assistant TEXT content
# (skipping tool_use / thinking blocks), posts to the ingest endpoint.
set +e
body=$(cat)
tp=$(printf '%s' "$body" | jq -r '.transcript_path // ""' 2>/dev/null)
resp=""
if [ -n "$tp" ] && [ -f "$tp" ]; then
  # Walk the transcript backwards, pick the last assistant turn whose
  # content[] contains at least one item with type='text'. Flatten the
  # text items with newlines.
  resp=$(jq -s -r '
    map(select(.type == "assistant" and (.message.content | type == "array")))
    | map(select(.message.content | map(.type == "text") | any))
    | last // null
    | if . == null then ""
      else .message.content | map(select(.type == "text") | .text) | join("\n")
      end
  ' < "$tp" 2>/dev/null)
fi
# Enrich the payload with response_summary and post.
enriched=$(printf '%s' "$body" | jq --arg r "$resp" '. + {response_summary: $r}' 2>/dev/null)
printf '%s' "$enriched" | curl -s -X POST http://localhost:3010/prompt-logs/api/events \
  -H 'Content-Type: application/json' -d @- >/dev/null 2>&1
exit 0
