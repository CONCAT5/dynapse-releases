export function codexUsageDelta(previous, now) {
    const old = previous && now.input_tokens >= previous.input_tokens && now.cached_input_tokens >= previous.cached_input_tokens && now.output_tokens >= previous.output_tokens ? previous : { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0 };
    return { input_tokens: now.input_tokens - old.input_tokens, cached_input_tokens: now.cached_input_tokens - old.cached_input_tokens, output_tokens: now.output_tokens - old.output_tokens };
}
