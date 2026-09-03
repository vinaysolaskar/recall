# Memory App — Architecture

**Status:** V1 Locked

**Architecture style:** Modular monolith

**Clients:** Expo mobile application

**Backend:** Node.js

**Database/Auth/Storage:** Supabase

**AI:** Groq

---

# 1. Architecture Principles

The architecture must optimize for:

1. Reliability of captured data.
2. Simple implementation.
3. Clear separation of concerns.
4. Zero-cost operation.
5. Easy provider replacement.
6. Mobile reliability.
7. Small-scale operation.

Do not introduce infrastructure complexity without a demonstrated V1 requirement.

---

# 2. High-Level Architecture

```text
┌──────────────────────────────────────────────┐
│                  Expo App                    │
│                                              │
│  Capture UI                                  │
│  Memory UI                                   │
│  Search                                      │
│  Folder UI                                   │
│  Local persistence                           │
│  Local audio storage                         │
└──────────────────────┬───────────────────────┘
                       │ HTTPS
                       ▼
┌──────────────────────────────────────────────┐
│                 Node Backend                 │
│                                              │
│  Auth boundary                               │
│  Memory module                               │
│  Capture module                              │
│  Processing module                           │
│  Search module                               │
│  AI/transcription adapters                   │
│  Quota/rate protection                       │
└───────────────┬──────────────────┬───────────┘
                │                  │
                ▼                  ▼
        ┌──────────────┐   ┌─────────────────┐
        │   Supabase   │   │      Groq       │
        │              │   │                 │
        │ PostgreSQL   │   │ Whisper V3      │
        │ Auth         │   │ GPT-OSS 20B     │
        │ Storage      │   │                 │
        └──────────────┘   └─────────────────┘
```

---

# 3. Architectural Style

Use a **modular monolith**.

The backend is one Node.js application with logical modules.

Recommended modules:

```text
auth
memories
captures
folders
processing
search
transcription
ai
storage
```

Do not create separate deployable microservices.

---

# 4. Mobile Architecture

Expo is responsible for:

* UI
* authentication session handling
* local capture persistence
* local audio persistence
* recording
* offline queueing
* synchronization requests
* playback
* user editing

The mobile app must not contain provider secrets.

The mobile app communicates with the backend over HTTPS.

---

# 5. Backend Architecture

The Node backend is responsible for:

* authenticated request handling
* authorization boundaries
* Memory/Capture operations
* synchronization
* storage operations
* processing jobs
* transcription provider integration
* LLM provider integration
* quota enforcement
* retries
* validation

Business/domain logic must not directly depend on Groq SDKs.

---

# 6. Domain Model

Conceptually:

```text
User
 ├── Folder
 └── Memory
       └── Capture
             ├── AudioAsset
             ├── Transcript
             ├── VoiceAnalysis
             └── Processing state
```

Memory-level:

```text
title
tags
folder
location
timestamps
```

Capture-level:

```text
source type
timestamp
text
audio
transcript
voice analysis
processing state
```

Do not over-normalize the model.

Keep the database simple enough to understand and maintain during V1.

---

# 7. Database

Use:

**Supabase PostgreSQL**

Expected logical entities:

```text
profiles
folders
memories
captures
audio_assets
transcripts
voice_analyses
processing_jobs
```

Exact columns, indexes, constraints, and foreign keys should be finalized during implementation.

All user-owned tables must enforce ownership.

---

# 8. Authentication

Use Supabase Auth.

The backend must establish the authenticated user before performing user-owned operations.

Never trust a client-provided user ID for authorization.

Authorization should be derived from the authenticated session.

---

# 9. Row Level Security

Supabase Row Level Security is required for user-owned data.

Conceptually:

```text
authenticated user
        ↓
only rows belonging to that user
```

A user must never be able to read or modify another user's:

* Memories
* Captures
* Folders
* transcripts
* processing data
* metadata

---

# 10. Storage

Use Supabase Storage for original audio.

Audio should be stored in private buckets.

Access must be authenticated or provided through appropriately scoped signed access.

Do not make original user audio publicly accessible.

The application-level maximum audio file size is:

```text
25 MB
```

---

# 11. Local Persistence

V1 uses offline capture-first architecture.

The mobile application must persist source data locally before depending on the network.

For voice:

```text
record
 ↓
save local audio
 ↓
create local Memory/Capture
 ↓
queue synchronization
```

For text:

```text
create text
 ↓
persist locally
 ↓
queue synchronization
```

A stable client-generated UUID must identify each Memory/Capture.

This prevents duplicate creation during retries.

---

# 12. Synchronization

Suggested local synchronization states:

```text
LOCAL_ONLY
SYNC_PENDING
SYNCING
SYNCED
SYNC_FAILED
```

Synchronization must be idempotent.

A repeated request for an already synchronized client UUID must not create duplicate Memories/Captures.

V1 does not require sophisticated distributed conflict resolution.

For conflicts, prefer simple deterministic behavior and preserve user-originated source data.

---

# 13. Processing Jobs

Use a database-backed processing job table.

Do not introduce:

* Kafka
* Redis
* RabbitMQ
* external queue infrastructure

unless implementation proves that they are necessary.

For V1 scale, a Node worker/polling mechanism is sufficient.

Conceptually:

```text
processing_jobs
      ↓
claim job
      ↓
process
      ↓
success / retry / failure
```

Recommended:

* one active transcription job per user
* bounded retries
* exponential/delayed retry
* provider-aware retry-after handling

---

# 14. Voice Pipeline

```text
Expo recording
      ↓
local audio persistence
      ↓
Memory/Capture created
      ↓
Level-1 audio analysis
      ↓
sync/upload
      ↓
processing job
      ↓
TranscriptionProvider
      ↓
transcript
      ↓
LLMProvider
      ↓
title + tags
      ↓
READY
```

The original audio remains the source artifact.

Processing failures must not delete it.

---

# 15. Processing State Machine

Conceptually:

```text
CAPTURED
   ↓
AUDIO_ANALYZING
   ↓
SYNC_PENDING
   ↓
SYNCING
   ↓
SYNCED
   ↓
TRANSCRIBING
   ↓
AI_ANALYSIS
   ↓
READY
```

Possible failures:

```text
UPLOAD_FAILED
TRANSCRIPTION_FAILED
AI_ANALYSIS_FAILED
```

Recovery must preserve already-successful stages.

For example:

```text
audio uploaded
 ↓
transcription fails
```

must not require re-uploading the audio unless necessary.

---

# 16. Provider Abstraction

The backend must expose provider interfaces independent of provider-specific implementations.

Conceptually:

```text
TranscriptionProvider
├── transcribe()
└── provider-specific implementation

LLMProvider
├── generateMemoryMetadata()
└── provider-specific implementation
```

V1:

```text
TranscriptionProvider
        ↓
GroqWhisperProvider
        ↓
whisper-large-v3
```

and:

```text
LLMProvider
        ↓
GroqLLMProvider
        ↓
openai/gpt-oss-20b
```

Provider SDKs must not leak into domain logic.

---

# 17. AI Processing

Only the backend communicates with Groq.

Flow:

```text
Memory
 ↓
collect relevant text
 ↓
limit to MAX_LLM_INPUT_CHARS
 ↓
LLMProvider
 ↓
structured output
 ↓
validate
 ↓
persist title/tags
```

One LLM request generates both title and tags.

Do not make separate requests.

---

# 18. AI Input

Input should contain only information required for title/tag generation:

* existing title where applicable
* user-written text
* generated transcript
* user-edited transcript

Maximum:

```text
24,000 characters
```

No audio is sent to the LLM.

If content exceeds the limit, reduce it deterministically while retaining useful context and Capture boundaries.

---

# 19. AI Output Validation

The backend must validate model output before persistence.

Expected:

```json
{
  "title": "string",
  "tags": ["string"]
}
```

Constraints:

```text
title <= 100 characters
tags <= 7
tag <= 30 characters
```

Invalid output:

```text
parse
 ↓
validation
 ↓
retry once
 ↓
failure state
```

Never persist unvalidated model output.

---

# 20. API Key Security

Provider keys must exist only on the backend.

Never expose:

```text
GROQ_API_KEY
```

to Expo.

Never use:

```text
EXPO_PUBLIC_GROQ_API_KEY
```

Never commit secrets to Git.

Use environment variables for local development and appropriate secret configuration for deployment.

---

# 21. Quota Protection

Protect quotas at multiple levels.

### Product limits

```text
5 Memories/account
15 minute recording
25 MB audio
10,000 character text
```

### AI limits

```text
Maximum 3 analyses per Memory
```

### Request throttling

Apply server-side throttling to AI/transcription operations.

### Retry control

Retry only appropriate failures.

Never create infinite retry loops.

---

# 22. Provider Failure Handling

### 429

Use provider retry information where available.

Queue/delay processing.

### 5xx

Retry with bounded exponential backoff.

### Network timeout

Retry with a bounded number of attempts.

### Invalid model output

Retry once.

### Persistent failure

Set an explicit failure state.

### Free quota exhausted

Do not switch to a paid provider or paid API automatically.

Preserve source data and surface an explicit UI state.

---

# 23. Security

Required:

* Supabase Auth
* Row Level Security
* authenticated backend requests
* private storage
* server-only provider secrets
* HTTPS
* input validation
* ownership checks
* bounded file sizes
* bounded text sizes

Do not log:

* API keys
* passwords
* raw audio
* unnecessary full transcripts
* unnecessary personal information

---

# 24. Deletion

Memory deletion should cascade logically through:

```text
Memory
 ↓
Captures
 ↓
Transcripts
 ↓
Voice analysis
 ↓
AI metadata
 ↓
Processing jobs
 ↓
Audio storage
```

Deletion must be designed so orphaned user audio does not remain unintentionally.

---

# 25. Mobile Reliability Requirements

Real-device testing must include:

* microphone permission denied
* microphone permission revoked
* incoming call
* app switch
* screen lock
* Bluetooth disconnect
* microphone interruption
* 15-minute recording limit
* app crash
* OS kill
* low device storage
* network loss during capture
* network loss during upload
* network loss during processing

Primary reliability principle:

> Source data must be preserved before network-dependent processing begins.

---

# 26. Observability

V1 requires lightweight observability only.

Useful server logs:

* job ID
* Memory/Capture ID
* user-scoped identifier where appropriate
* processing stage
* success/failure
* retry count
* provider status/error category

Never log sensitive source contents unnecessarily.

No full observability platform is required for V1.

---

# 27. Infrastructure Constraints

The architecture must remain compatible with the project's $0 requirement.

Do not introduce paid infrastructure.

Do not add infrastructure solely for hypothetical scale.

The expected scale is:

```text
2–3 users
5 Memories/account
```

Architecture should be clean and replaceable, but implementation should remain intentionally small.

---

# 28. Definition of Architectural Success

The architecture is successful if:

1. A Memory can be captured without network connectivity.
2. Source data survives provider failures.
3. AI providers can be replaced without rewriting domain logic.
4. User data is isolated.
5. Processing is asynchronous.
6. The system does not require distributed infrastructure.
7. The application remains within the $0 target.
8. The codebase remains understandable to a single developer and coding agent.