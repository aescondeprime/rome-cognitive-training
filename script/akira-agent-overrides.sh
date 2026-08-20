#!/usr/bin/env bash
#
# Enable the prompt override on Akira's ElevenLabs agent.
#
# ROME sends its ROME capability catalogue as a per-conversation system prompt
# override. ElevenLabs disables overrides by default and closes the WebSocket
# with code 1008 when it receives one that has not been allowed, so this has to
# be switched on once per agent.
#
# The dashboard exposes this under the agent's Security tab, but that UI moves
# around; this does the same thing through the API.
#
# Usage:
#   export ELEVENLABS_API_KEY=sk_...
#   bash script/akira-agent-overrides.sh agent_0501m0aq1awkfxwvmszcwyez79j9
#
# The key is read from the environment and never printed.

set -euo pipefail

AGENT_ID="${1:-}"
API="https://api.elevenlabs.io/v1/convai/agents"

if [ -z "$AGENT_ID" ]; then
  echo "usage: bash script/akira-agent-overrides.sh <agent_id>" >&2
  exit 2
fi

if [ -z "${ELEVENLABS_API_KEY:-}" ]; then
  echo "Set ELEVENLABS_API_KEY first:" >&2
  echo "  export ELEVENLABS_API_KEY=sk_..." >&2
  exit 2
fi

have_jq() { command -v jq >/dev/null 2>&1; }

show_overrides() {
  local label="$1"
  echo "── $label ─────────────────────────────────"
  local body
  body="$(curl -fsS -H "xi-api-key: ${ELEVENLABS_API_KEY}" "${API}/${AGENT_ID}")"
  if have_jq; then
    echo "$body" | jq '.platform_settings.override // .platform_settings.overrides // "no override block found"'
  else
    # No jq: print just the neighbourhood of the override block.
    echo "$body" | tr ',' '\n' | grep -i -A2 -B2 'override' || echo "(no override block found)"
  fi
  echo
}

echo "Agent: ${AGENT_ID}"
echo
show_overrides "BEFORE"

echo "── Enabling prompt override ───────────────"
curl -fsS -X PATCH "${API}/${AGENT_ID}" \
  -H "xi-api-key: ${ELEVENLABS_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
        "platform_settings": {
          "override": {
            "conversation_config_override": {
              "agent": { "prompt": { "prompt": true } }
            }
          }
        }
      }' > /dev/null
echo "PATCH sent."
echo

show_overrides "AFTER"

echo "If AFTER shows prompt: true, restart ROME and try Command+' again."
echo "If it still shows false, the field name differs on your account —"
echo "send the BEFORE block above (it contains no secrets) and it can be corrected."
