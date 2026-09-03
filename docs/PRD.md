# Memory App — Product Requirements Document

**Status:** V1 Locked

**Purpose:** Personal memory-building system

**Target:** Android + iOS mobile app

**Scale:** Personal showcase / 2–3 real users

**Cost constraint:** $0 / ₹0 — no paid infrastructure or API usage

---

## 1. Product Definition

This product is a **personal memory-building system**, not a task manager, trip planner, generic AI assistant, or social application.

The core loop is:

**Capture → Preserve → Understand → Retrieve**

The product helps users capture moments, notes, conversations, and experiences and later retrieve them through search and organization.

### Core terminology

**Memory** = a recallable unit.

**Capture** = an individual source/input added to a Memory.

A Memory may contain multiple Captures of different types.

Example:

```text
Memory: "Japan — Day 1"

Capture 1 — Voice — 10:42 AM
Capture 2 — Text  — 11:15 AM
Capture 3 — Voice — 12:03 PM
```

A new capture initially creates a new Memory. Additional captures can later be added to an existing Memory.

---

# 2. V1 Goals

V1 must allow a user to:

1. Register and authenticate.
2. Create text Memories.
3. Record voice Memories.
4. Add additional text or voice Captures to an existing Memory.
5. Preserve original voice recordings.
6. Automatically transcribe voice Captures.
7. Support multilingual and code-switched speech.
8. Generate an AI title and tags for a Memory.
9. Edit titles, transcripts, and tags.
10. Organize Memories into user-controlled folders.
11. Search Memories.
12. View a Memory as a timeline of Captures.
13. Capture while offline and synchronize later.
14. Retry failed processing.
15. Delete a Memory and its associated data.
16. See clear processing and failure states.

---

# 3. Non-Goals

The following are explicitly OUT OF SCOPE for V1:

* Task management
* Trip planning as the primary product
* AI chat
* RAG
* Vector databases
* Embeddings
* Semantic search
* Entity graphs
* Topic graphs
* Sentiment/emotion analysis
* Automatic folder assignment
* Social features
* Memory sharing
* Public links
* Collaborative Memories
* Google/Apple authentication
* Magic links
* Web application
* Tablet-specific UI
* Desktop application
* App Store / Play Store launch
* Advanced analytics
* Complex distributed infrastructure
* Microservices
* Kafka
* Redis unless proven necessary
* Kubernetes
* Event sourcing
* Sophisticated distributed conflict resolution

---

# 4. Supported Platforms

V1 supports:

* Android phones
* iOS phones

No tablet or web-specific product is required.

---

# 5. Authentication

V1 uses:

* Supabase Auth
* Email + password

No social login is required.

Every Memory belongs to exactly one authenticated user.

---

# 6. Memory Model

A Memory is the primary recallable product object.

A Memory can contain:

* one or more Captures
* title
* user-written text where applicable
* AI-generated tags
* date/time
* optional location
* folder or Unfiled state
* derived processing information

A Memory may contain mixed Capture types.

---

# 7. Capture Model

A Capture represents an individual source/input.

Supported Capture types:

* Voice
* Text

Each Capture has:

* stable ID
* Memory ID
* creation timestamp
* source type
* processing state
* original source data where applicable

Capture timestamps represent **capture time**, not processing completion time.

---

# 8. Text Capture

Text input:

* Maximum 10,000 characters.
* User-originated text must always remain editable.
* Text is searchable.
* Text contributes to Memory-level AI title/tag generation.

Text capture must be fast and must not require organization before saving.

---

# 9. Voice Capture

Voice is a first-class V1 feature.

### Limits

```text
Maximum duration: 15 minutes
Maximum uploaded audio file size: 25 MB
```

The application must stop recording automatically at 15 minutes.

The user must be clearly informed that the recording stopped because the maximum duration was reached.

### Recording interruptions

The application must handle major interruptions including:

* App switching
* Screen locking
* Incoming calls
* Microphone interruption
* Bluetooth/headset disconnect
* Permission changes
* OS termination
* Other major microphone interruptions

The application must never silently pretend recording continued after an interruption.

Everything successfully captured before an interruption should be preserved whenever technically possible.

### Golden rule

> Once recording has successfully been captured locally, network or provider failure must never destroy the Memory or original recording.

---

# 10. Local-First Capture

V1 uses **offline capture-first**, not a fully offline-first distributed architecture.

Offline, the application must support:

* Creating a Memory
* Creating a text Capture
* Recording voice
* Saving voice locally
* Queuing synchronization

Network-dependent operations include:

* Cloud synchronization
* Audio upload
* Transcription
* AI title/tag generation
* Cloud search
* Cross-device synchronization of unsynced data

Stable client-generated UUIDs should be used to prevent duplicate synchronization.

---

# 11. Voice Processing

Voice processing pipeline:

```text
Record locally
    ↓
Persist original audio
    ↓
Level-1 audio analysis
    ↓
Upload / synchronize
    ↓
Processing queue
    ↓
Transcription
    ↓
AI title + tags
    ↓
Ready
```

Processing must be asynchronous.

The user must not have to keep the application open while waiting for all processing to complete.

---

# 12. Level-1 Voice Analysis

Level-1 analysis must be deterministic/non-LLM.

Required measurements:

* Duration
* Speech presence
* Background noise
* Clipping
* Audio quality
* File size

Derived result:

```text
Good
Fair
Poor
```

The UI should provide useful explanations when quality is Fair or Poor.

No language information needs to be stored or displayed as a product feature.

---

# 13. Transcription

Provider: **Groq**

Model: **whisper-large-v3**

Requirements:

* Automatic language detection
* English
* Hindi
* Marathi
* English + Hindi
* Marathi + English
* Other code-switching where supported by the model
* Preserve spoken language
* Preserve code-switching
* No automatic translation

If the user speaks in Roman/Latin-script Hinglish, do not intentionally convert it to Devanagari.

Example:

```text
Aaj anatomy practical mein...
```

should remain represented naturally rather than being forcibly translated or transliterated.

### Provider abstraction

Business logic must depend on:

```text
TranscriptionProvider
```

and not directly on Groq.

V1 implementation:

```text
GroqWhisperProvider
```

---

# 14. AI Title and Tags

AI is intentionally small in V1.

The AI generates only:

* One title
* 3–7 tags

AI does not generate:

* summaries
* translations
* folders
* sentiment
* entities
* people profiles
* topic graphs
* chat responses

### Provider

Groq.

### Model

```text
openai/gpt-oss-20b
```

The implementation must use an abstraction:

```text
LLMProvider
```

with:

```text
GroqLLMProvider
```

as the V1 implementation.

---

# 15. AI Metadata Rules

AI-derived title and tags belong to the **Memory**, not individual Captures.

The title generated by AI is only an initial suggestion.

The user can edit it.

AI-generated tags can be:

* added
* removed
* edited

User-originated information always takes precedence over AI-derived information.

AI-derived information is never authoritative.

---

# 16. AI Input

The LLM receives relevant Memory content:

* Existing user title, if applicable
* User-written text
* Generated transcript
* User-edited transcript

Maximum LLM input:

```text
24,000 characters
```

If content exceeds this limit, the backend must reduce the input deterministically while preserving useful context and Capture boundaries.

The backend must not send raw audio to the LLM.

---

# 17. AI Output

The expected structure is:

```json
{
  "title": "Anatomy Practical Preparation",
  "tags": [
    "anatomy",
    "practical",
    "medical school"
  ]
}
```

Validation requirements:

```text
title:
- required
- string
- maximum 100 characters

tags:
- array
- maximum 7 items
- each tag maximum 30 characters
```

Invalid model output may be retried once.

If validation still fails, AI processing enters a failure state without affecting the underlying Memory.

---

# 18. AI Processing Frequency

One LLM call should generate both title and tags.

Do not make separate calls for title and tags.

New Memory:

```text
Memory created
    ↓
One AI analysis
```

When a Memory changes through additional Captures, metadata may be regenerated after the Memory becomes stable.

Rapid successive Captures should be debounced to avoid unnecessary AI calls.

Manual regeneration is limited.

Recommended maximum:

```text
3 AI analyses per Memory
```

The server must enforce AI usage limits.

---

# 19. Search

Search must return Memories.

Searchable fields, in priority order:

1. Memory title
2. User-written text
3. Generated transcript
4. User-edited transcript
5. AI tags

Search must allow the user to open the Memory and read/listen to its Captures.

V1 does not promise semantic cross-language search.

No:

* embeddings
* vector database
* RAG
* LLM query rewriting
* semantic search

---

# 20. Transcript Editing

Generated transcript and user-edited transcript should be conceptually distinct.

The original audio remains the source artifact.

The user-edited transcript becomes the displayed/searchable transcript.

The application must never overwrite or destroy the original audio because of transcript editing.

---

# 21. Folders

Folders are entirely user-controlled.

AI must never automatically move a Memory into a folder.

Constraints:

```text
Maximum depth: 2
Maximum root folders: 5
Maximum children per root: 5
Maximum total folders: 30
Maximum folder name: 30 characters
```

A Memory belongs to:

* exactly one folder

or:

* Unfiled

V1 does not support:

* multiple folders per Memory
* folder metadata
* folder reordering
* moving Memories between folders after creation

Organization must never block capture.

---

# 22. Location

Location is optional.

If the user grants location permission:

* capture location at Memory/Capture creation time

If permission is unavailable:

* Memory creation still works normally.

Location must never be required for capture.

---

# 23. Deletion

Deleting a Memory must remove associated data appropriately, including:

* Captures
* Audio assets
* Transcripts
* AI metadata
* Processing jobs
* Searchable derived data

Individual deletion of original audio from a voice Memory is not supported in V1.

The original audio remains associated with the Memory until the Memory itself is deleted.

---

# 24. Privacy

All Memories are private.

V1 has:

* no sharing
* no public links
* no social features

Security requirements:

* authenticated access
* per-user ownership
* Row Level Security
* private storage
* provider secrets only on backend
* HTTPS
* no unnecessary logging of audio or full transcripts
* never log API keys or passwords

---

# 25. Hard Application Limits

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

These are application-level limits.

They must not be treated as fundamental database architecture limitations.

---

# 26. Processing States

A Capture/processing pipeline should support states conceptually equivalent to:

```text
CAPTURED
AUDIO_ANALYZING
SYNC_PENDING
SYNCING
SYNCED
TRANSCRIBING
AI_ANALYSIS
READY
```

Failure states:

```text
UPLOAD_FAILED
TRANSCRIPTION_FAILED
AI_ANALYSIS_FAILED
```

Failures must never destroy source data.

Retries should be possible where appropriate.

---

# 27. Quota Exhaustion

The application must never automatically switch to a paid provider or paid API tier.

If a provider's free quota is exhausted:

### Transcription

Show:

> Transcription temporarily unavailable. The free transcription limit has been reached. Your recording is safely saved and will be processed when transcription becomes available again.

### AI metadata

Show:

> AI metadata temporarily unavailable. Your memory was saved successfully, but the free AI limit has been reached. Title and tags will be generated when AI processing is available again.

The Memory remains usable without AI metadata.

---

# 28. UX Principle

Primary principle:

> Optimize for capture speed, not organization effort.

Ideal flow:

```text
Open
 ↓
Capture
 ↓
Save
 ↓
AI/background processing
 ↓
Memory timeline
```

The user should not be forced to choose a folder, title, or tags before successfully saving a capture.

---

# 29. V1 Success Criteria

The product is considered V1-complete when a user can:

```text
Register
 ↓
Create Memory
 ↓
Capture text or voice
 ↓
Save locally
 ↓
Synchronize
 ↓
Transcribe voice
 ↓
Generate title + tags
 ↓
Edit metadata/transcript
 ↓
Search
 ↓
Open Memory
 ↓
Review Capture timeline
 ↓
Organize into folders
```

and the system remains safe when:

* network disappears
* transcription fails
* AI fails
* recording is interrupted
* the application is killed
* permissions are denied
* provider quotas are exhausted.