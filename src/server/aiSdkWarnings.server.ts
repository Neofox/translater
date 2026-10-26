// AI SDK provider warnings can contain source text, raw response bodies, or
// credentials. Speech generation has no per-call warning hook; provider
// warnings use this shared SDK logger.
//
// Establish one process-wide policy and never toggle/restore it per request.
// Concurrent speech and translation calls share this setting; suppressing
// warning contents leaves the separate content-free telemetry policy intact.
globalThis.AI_SDK_LOG_WARNINGS = false

export {}
