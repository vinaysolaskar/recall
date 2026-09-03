# Copilot Instructions — Memory App

## 1. Source of Truth

Before implementing or making architectural/product decisions, read:

```text
docs/PRD.md
docs/ARCHITECTURE.md
```

These documents are authoritative for V1 product scope and architecture.

If the requested implementation conflicts with either document, stop and explain the conflict before changing the product or architecture.

Do not silently reinterpret requirements.

---

# 2. Product Identity

This is a **personal memory-building system**.

It is NOT:

* a task manager
* a trip planner
* a generic AI assistant
* a social application
* a chatbot
* a productivity suite

Core loop:

```text
Capture → Preserve → Understand → Retrieve
```

Use the product terminology consistently:

```text
Memory = recallable unit
Capture = individual source/input inside a Memory
```

Do not rename these concepts casually.

---

# 3. V1 Scope Discipline

Implement only requirements defined in `docs/PRD.md`.

Do not add features because they seem useful.

Do not introduce:

* AI chat
* RAG
* embeddings
* vector DB
* semantic search
* entity graphs
* sentiment analysis
* social sharing
* automatic folders
* unnecessary analytics
* task management
* trip-planning features

If a feature is not required for V1, prefer not implementing it.

---

# 4. Architecture Discipline

Use the architecture defined in:

```text
docs/ARCHITECTURE.md
```

The application uses:

```text
Expo
    ↓
Node.js modular monolith
    ↓
Supabase
    ↓
Groq
```

Do not introduce major infrastructure without explicit justification.

Do not add:

* microservices
* Kafka
* Redis
* RabbitMQ
* Kubernetes
* vector databases
* graph databases
* event sourcing
* complex distributed systems

unless a real V1 requirement proves they are necessary.

For this project, simplicity is a feature.

---

# 5. Before Making Major Changes

For a small implementation task:

1. Read the relevant code.
2. Read relevant PRD/architecture requirements.
3. Make the smallest appropriate change.
4. Run relevant tests/type checks.
5. Explain what changed.

For a major architectural change:

1. Stop.
2. Explain why the existing architecture is insufficient.
3. Propose the change.
4. Do not implement it until explicitly approved.

Never silently redesign the architecture.

---

# 6. Provider Abstraction

Business logic must never directly depend on Groq.

Use:

```text
TranscriptionProvider
LLMProvider
```

V1 implementations:

```text
GroqWhisperProvider
GroqLLMProvider
```

Current models:

```text
whisper-large-v3
openai/gpt-oss-20b
```

Keep provider-specific code isolated.

Changing providers later should not require rewriting Memory/Capture business logic.

---

# 7. Secrets

Never put provider secrets in Expo/mobile code.

Never create:

```text
EXPO_PUBLIC_GROQ_API_KEY
```

Never commit API keys.

Groq credentials belong exclusively to the Node backend.

Do not print secrets in logs.

If an environment variable is required, document its name without exposing its value.

---

# 8. Memory/Capture Model

Treat:

```text
Memory
```

as the primary recallable object.

Treat:

```text
Capture
```

as an individual source inside a Memory.

A Memory can contain:

* voice Captures
* text Captures
* mixed Captures

AI title and tags belong to the Memory.

Do not attach Memory-level AI metadata to individual Captures unless the PRD explicitly requires it.

---

# 9. User Data Is More Important Than Processing

The golden rule:

> Once source data has been successfully captured locally, provider/network failure must never destroy it.

Never delete or overwrite:

* original audio
* user-written text
* user-edited transcript

because an AI or network operation failed.

Processing is recoverable.

Source data is authoritative.

---

# 10. AI Is Not Authoritative

AI-generated data is derived data.

The user can override it.

User-originated data takes precedence over AI output.

Never silently replace:

* user titles
* user text
* edited transcripts
* user tags

with AI-generated values.

---

# 11. Transcription Rules

Use:

```text
whisper-large-v3
```

Requirements:

* automatic language detection
* multilingual speech
* English
* Hindi
* Marathi
* English/Hindi code-switching
* Marathi/English code-switching
* preserve spoken language
* no automatic translation

Do not add translation.

Do not intentionally transliterate Roman/Latin-script speech into another script.

---

# 12. Voice Recording Rules

Maximum:

```text
15 minutes
25 MB
```

The app must automatically stop recording at 15 minutes.

Major interruptions must not be silently ignored.

When possible, preserve everything captured before the interruption.

Test recording behavior on real devices.

Do not assume emulator behavior represents real microphone behavior.

---

# 13. Local Capture

Persist source data locally before network-dependent work.

Voice:

```text
record
→ persist local audio
→ create local Capture
→ queue sync
```

Text:

```text
create text
→ persist local Capture
→ queue sync
```

Use stable UUIDs.

Synchronization must be idempotent.

Avoid duplicate Memories/Captures during retry.

---

# 14. Processing Jobs

Use database-backed processing jobs.

Do not introduce a distributed queue for V1.

Processing must be asynchronous.

Use bounded retries.

Never implement infinite retry loops.

Prefer:

```text
retryable error
→ delayed retry
→ bounded attempts
→ explicit failure
```

over aggressive immediate retries.

---

# 15. AI Title/Tag Generation

Use ONE LLM call to generate both:

```text
title
tags
```

Do not make separate calls.

Expected structure:

```json
{
  "title": "string",
  "tags": ["string"]
}
```

Validate output before saving.

Constraints:

```text
title <= 100 characters
tags <= 7
tag <= 30 characters
```

Retry invalid output at most once.

If validation still fails, preserve the Memory and mark AI processing as failed.

---

# 16. LLM Input

Maximum:

```text
24,000 characters
```

Use relevant Memory content:

* existing title where applicable
* user text
* transcript
* edited transcript

Do not send audio to the LLM.

If content exceeds the limit, reduce it deterministically.

Do not introduce embeddings or summarization just to solve this problem.

---

# 17. Folders

Folders are user-controlled.

AI must NEVER automatically assign or move a Memory into a folder.

Respect:

```text
max depth = 2
max root folders = 5
max children/root = 5
max total folders = 30
max folder name = 30 chars
```

A Memory can be:

```text
one folder
```

or:

```text
Unfiled
```

Do not implement multiple-folder membership.

---

# 18. Search

Search these fields:

1. title
2. user text
3. generated transcript
4. edited transcript
5. tags

Do not implement:

* semantic search
* embeddings
* vector search
* RAG
* LLM query rewriting

unless the PRD is explicitly changed.

---

# 19. Security

Always enforce:

* authenticated access
* ownership checks
* Supabase RLS
* private storage
* backend-only provider credentials
* input validation
* file size limits
* text size limits

Never trust a user-provided user ID for authorization.

Never expose another user's data.

---

# 20. Error Handling

Errors should be categorized.

Examples:

```text
UPLOAD_FAILED
TRANSCRIPTION_FAILED
AI_ANALYSIS_FAILED
SYNC_FAILED
```

Do not show misleading messages.

Example:

If recording succeeded but transcription failed, do NOT tell the user:

> Recording failed.

Instead communicate that:

> The recording was saved, but transcription is currently unavailable.

Always distinguish:

```text
source capture failure
```

from:

```text
processing failure
```

---

# 21. Provider Quota Exhaustion

Never automatically switch to a paid provider or paid tier.

When a free quota is exhausted:

* preserve source data
* mark processing appropriately
* queue/retry later where possible
* clearly communicate the state to the user

The application must remain a $0 project.

---

# 22. Hard Limits

Respect these values:

```text
MAX_MEMORIES = 5
MAX_RECORDING_SECONDS = 900
MAX_AUDIO_BYTES = 25 MB
MAX_TEXT_CHARS = 10,000

MAX_ROOT_FOLDERS = 5
MAX_CHILD_FOLDERS = 5
MAX_TOTAL_FOLDERS = 30
MAX_FOLDER_NAME_CHARS = 30

MAX_LLM_INPUT_CHARS = 24,000
MAX_AI_ANALYSES_PER_MEMORY = 3
```

Keep these as configurable application constants/configuration where practical.

Do not hard-code these values into database architecture in ways that make future changes difficult.

---

# 23. Code Quality

Prefer:

* simple code
* explicit types
* small modules
* clear names
* predictable control flow
* reusable domain logic
* testable functions

Avoid:

* unnecessary abstractions
* premature optimization
* speculative frameworks
* excessive dependency additions
* clever code that is difficult to debug

The project has a four-day implementation window.

Optimize for correctness and clarity.

---

# 24. Dependencies

Before adding a new dependency, ask:

1. Is it necessary?
2. Is it already provided by Expo/Node/Supabase?
3. Does it materially simplify a required V1 feature?
4. Does it introduce security or maintenance concerns?

Do not add libraries simply because they are popular.

For major dependencies, explain the reason before introducing them.

---

# 25. Testing Priority

Prioritize tests for:

1. Memory/Capture creation
2. ownership/security
3. synchronization idempotency
4. recording limits
5. processing state transitions
6. retry behavior
7. provider failure handling
8. transcript editing
9. folder constraints
10. deletion

Real-device testing is mandatory for microphone and interruption behavior.

---

# 26. UI Principles

Optimize for:

> Capture speed over organization effort.

Do not force the user to:

* choose a folder
* create a title
* create tags

before successfully capturing a Memory.

Processing should happen in the background.

Always provide appropriate:

* loading states
* processing states
* empty states
* error states
* retry states

---

# 27. Development Workflow

When implementing a task:

```text
Understand requirement
        ↓
Inspect existing code
        ↓
Implement smallest solution
        ↓
Run tests/type checks
        ↓
Review changed files
        ↓
Explain result
```

Do not make unrelated refactors while implementing a feature.

Keep commits focused.

---

# 28. When Requirements Are Ambiguous

Prefer the existing PRD and architecture.

If the ambiguity affects:

* product behavior
* data model
* security
* architecture
* provider choice
* infrastructure

do not invent a major decision silently.

Explain the ambiguity and propose the smallest V1-compatible solution.

---

# 29. Four-Day Constraint

This is a four-day implementation.

Prioritize:

```text
working product
>
reliability
>
security
>
clear architecture
>
polish
>
nice-to-have features
```

Do not sacrifice the core product to build infrastructure for hypothetical future scale.

---

# 30. Final Rule

Build the product that is specified.

Do not turn the project into something larger because an abstraction, framework, AI technique, database, or infrastructure component seems interesting.

When in doubt:

> Preserve the user's source data, keep the architecture simple, respect the PRD, and ship the smallest reliable V1.