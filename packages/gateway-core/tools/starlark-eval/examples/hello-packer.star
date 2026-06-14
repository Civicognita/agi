# hello-packer.star — demo packer script (s102 Phase F)
#
# A packer script receives arbitrary JSON input and returns a dict that
# will be injected into the agent's context before the LLM is invoked.
#
# This demo packs a simple greeting + metadata about the input.
# Real packers would enrich context with structured MApp-specific data.
#
# Run via: POST /api/scripts/:id/compile (encode source), then
#          run_script agent tool or the ScriptRunner.run() API.

def main(input):
    """Pack a greeting and input summary into agent context."""
    msg = input.get("message", "") if type(input) == "dict" else str(input)
    word_count = len(msg.split()) if msg else 0

    return {
        "packer": "hello-packer",
        "greeting": "Hello from Starlark! I see a message with {} word(s).".format(word_count),
        "word_count": word_count,
        "has_input": input != None,
    }
