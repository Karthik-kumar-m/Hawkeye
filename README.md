# Hawkeye

Hawkeye: The Exam Guardrail System is a full-stack assessment integrity platform built to bring real-time observability, behavioral monitoring, and post-exam credibility analysis to browser-based examinations. The system combines a student-facing exam client with a live administrative monitoring dashboard so institutions can evaluate not only academic responses, but also the integrity posture of each session as it unfolds.

Unlike heavyweight proctoring solutions that require intrusive local agents, Hawkeye operates as a lightweight, integrity-first middleware layer on top of the browser. It uses native browser APIs, client-side event instrumentation, WebSocket streaming, and server-side scoring logic to detect suspicious interaction patterns and convert them into an actionable Credibility Report.

## Executive Summary

Hawkeye was designed for a practical reality: most online exams are delivered through standard web browsers, yet browsers are optimized for open exploration rather than controlled assessment. That mismatch creates a structural integrity gap. Students can leave the exam tab, shrink the exam window to make space for external material, attempt copy-paste workflows, or remain inactive while consulting unauthorized sources, all without traditional exam systems providing meaningful behavioral context.

Hawkeye addresses this gap through a two-part architecture. The Sentinel Client serves as the controlled exam workspace, continuously monitoring the browser environment for prohibited behaviors. The Auditor Dashboard provides instructors and administrators with a live operational view of each active session, including violation timelines, session state, and a continuously updated Trust Score from 0 to 100. Together, these components enable real-time supervision and evidence-backed post-exam review without requiring invasive software installation on student devices.

## The Problem

Browser-based assessments are convenient and scalable, but they inherit the openness of the web platform. In a standard exam delivery model, the browser remains capable of multitasking, navigation, content copying, developer-tool access, and layout manipulation. This creates several reliability issues:

- Tab switching allows a student to leave the exam context and consult external sources.
- Window resizing enables side-by-side viewing of notes, search results, or communication tools.
- Keyboard shortcuts can expose browser controls, clipboard actions, print capture, or developer tooling.
- Long inactivity intervals can indicate disengagement from the exam surface while attention is diverted elsewhere.

The result is not just isolated policy violations, but an absence of measurable, time-stamped evidence about what happened during the exam session. Traditional browser-based testing systems may record answers and submission time, yet they often fail to generate a behavioral integrity trail. Hawkeye was built to close that observability gap.

## The Solution & Architecture

Hawkeye is structured as a coordinated frontend-backend system with real-time event streaming.

### Sentinel Client

The Sentinel Client is the frontend exam interface built with React, Tailwind CSS, and Vite. It is responsible for delivering the exam experience while simultaneously acting as a browser-behavior sensor layer. During an active session, it attaches event listeners to the document and window, monitors browser state changes, and normalizes these signals into structured exam events.

When a suspicious action is detected, the client emits a `VIOLATION_DETECTED` event over a persistent WebSocket channel tied to the student session. Payloads include machine-readable reasons such as `tab_switch_duration`, `window_resized_below_threshold`, `blocked_keyboard_shortcut`, and `idle_timeout`, along with supporting metadata like away duration, key combinations, or measured window area ratios.

### Auditor Dashboard

The Auditor Dashboard is the administrative monitoring surface powered by FastAPI, WebSockets, and a relational persistence layer. It acts as the real-time observability hub for active exam sessions. Every event received from the Sentinel Client is persisted as a tracking record, enriched with server-side trust-state updates, and broadcast to connected monitoring views.

This gives instructors a live timeline of student behavior rather than a delayed postmortem. The dashboard can show when a session started, when a violation occurred, how long a student was away from the exam, how many violations accumulated, and what the current Trust Score is at that exact moment.

### Real-Time Interaction Model

The system operates as a continuous loop:

1. A student starts an exam session in the Sentinel Client.
2. The client opens a WebSocket connection bound to that session.
3. Browser integrity events are captured locally and transmitted immediately.
4. The FastAPI backend persists each event and updates trust state when applicable.
5. The backend broadcasts enriched monitoring events to the Auditor Dashboard.
6. The dashboard renders a live violation timeline and updated Trust Score for administrative review.

This architecture separates enforcement and observability concerns cleanly: the frontend detects and constrains behavior at the point of interaction, while the backend converts raw behavioral telemetry into durable session evidence.

## Core Technical Mechanics

Hawkeye’s integrity model is built around four primary guardrails engineered directly into the browser session.

### 1. Tab-Switching Detection

The system uses the Page Visibility API to determine when the exam document is no longer visible. When the page becomes hidden, the Sentinel Client records the departure timestamp and logs the start of a tab-switch violation. When visibility returns, the client computes the exact away duration in seconds and emits a follow-up violation event containing the measured absence interval.

This approach is important because it produces more than a binary signal. Instead of only recording that the student left the tab, Hawkeye records how long they stayed away, which materially improves the quality of the resulting credibility assessment.

### 2. Window Resizing Guardrail

To counter side-by-side browsing and reduced exam visibility, the client calculates the ratio between the active browser window area and the available screen area. If the effective exam surface falls below 80 percent of the screen area, the action is treated as a violation and logged with the measured ratio and configured threshold.

This implementation is more defensible than relying on width alone, because it evaluates usable screen real estate as a compound measurement of both width and height. When the window returns to an acceptable size, the client emits a normalization event so the monitoring timeline reflects both the violation and the recovery.

### 3. Keyboard Hijacking and Shortcut Suppression

The Sentinel Client intercepts prohibited keyboard activity at both the `window` and `document` levels using capture-phase listeners. It prevents default execution and logs intent when a student attempts actions associated with copying, pasting, browser control, developer tooling, or screen capture.

Blocked combinations include copy and paste patterns such as `Ctrl+C` and `Ctrl+V`, browser-oriented shortcuts, developer-tool accelerators, `F12`, and `Print Screen`. Each blocked action is converted into a structured violation payload with the triggering key and modifier state, allowing the backend to retain a precise record of the attempted action without exposing exam content.

### 4. Idle Detection

Hawkeye treats prolonged inactivity as a meaningful integrity signal. The client maintains a rolling inactivity timer that is reset by user interaction events including mouse movement, key presses, mouse clicks, and touch input. If no qualifying activity occurs for more than 60 seconds, the client emits an `idle_timeout` violation.

When activity resumes, the client records an `IDLE_RESUMED` event so the administrative timeline reflects both the onset and the end of the inactive period. This creates a more complete behavioral narrative and helps distinguish brief pauses from suspiciously extended disengagement.

## The Trust Score Algorithm

Each exam session begins with a Trust Score of 100. As violation events arrive over the session WebSocket, the backend applies a reason-aware deduction model that reduces the score according to behavioral severity.

Low-severity events such as blocked clipboard or shortcut attempts carry smaller penalties. Moderate events such as window resizing below threshold or idle timeouts apply stronger deductions. Higher-risk context changes such as fullscreen exit, tab switching, and focus loss carry larger penalties, with time-based violations scaled further by the measured away duration. Longer absences from the exam surface therefore have a greater impact than brief accidental context changes.

The resulting score is clamped between 0 and 100 and updated in real time as the session progresses. This allows Hawkeye to generate a final Credibility Report that is not based on a single rule trigger, but on the cumulative behavioral profile of the exam attempt. In practice, the Trust Score is best understood as an integrity confidence indicator: a quantitative summary of how consistently the student remained inside the expected exam environment.

## Architectural Value

Hawkeye’s core value lies in combining browser-native enforcement with real-time administrative visibility. It does not attempt to install invasive device-level surveillance software. Instead, it provides a pragmatic web-first control plane for digital assessments, giving educators a live behavioral evidence stream, a durable event timeline, and a defensible post-exam credibility signal.

For institutions seeking a lightweight alternative to heavyweight proctoring stacks, Hawkeye provides a strong middle ground: immediate detection, continuous observability, and auditable integrity scoring within a standard browser-based delivery model.

## Current Feature Set

### Student experience

- Dual-purpose login page with student and teacher modes.
- Schedule-aware student access using USN plus test ID.
- Test availability countdown before start time and before window close.
- Automatic resume of an already active session instead of creating duplicates.
- Exam workspace with timed submission flow, question navigation, and live event tracking.
- Violation reporting for tab switching, focus loss, fullscreen exit, blocked shortcuts, right-click, idle time, and window resizing.

### Teacher experience

- Teacher registration and login.
- Upload exam papers as PDFs.
- Upload a student USN roster PDF and auto-provision access for accepted students.
- Preview USN extraction before publishing a test.
- Preview parsed questions from a PDF or structured text file before upload.
- Automatic test scheduling at upload time using the chosen duration.
- Live monitoring dashboard with WebSocket updates from student sessions.
- Results view with score percentage, correct answers, total questions, trust score, and violations.
- Session timeline view with detailed event payloads.
- Resource management modal for allowed external links.

### Backend behavior

- Automatic table creation on startup for local development.
- Lightweight schema backfill for test schedule columns and question answer keys.
- Auto-grading based on stored question answer keys or parsed fallback question data.
- Static hosting for uploaded test PDFs.

## Recent Changes

- Project branding has been renamed to Hawkeye across the application.
- The login page now uses a Hawkeye brand treatment instead of the older generic identity.
- README content has been aligned with the current codebase instead of the earlier high-level prototype description.
- Database setup now defaults to SQLite for zero-setup local development, with PostgreSQL still supported through `DATABASE_URL`.
- Test creation flow reflects the current implementation: upload now starts the exam window immediately and closes it after the selected duration.
- Teacher monitoring and scoring sections now reflect the actual session, event, and grading endpoints in the backend.

## Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18, Vite, Tailwind CSS, React Router |
| Backend | FastAPI, SQLAlchemy async, Pydantic v2, Uvicorn |
| Database | SQLite by default, PostgreSQL via `DATABASE_URL` |
| Real-time | Native WebSockets |
| Document parsing | `pypdf` |

## Routes

| URL | Purpose |
|-----|---------|
| `http://localhost:5173/` | Combined student and teacher login page |
| `http://localhost:5173/exam` | Student exam workspace after session start |
| `http://localhost:5173/teacher` | Teacher dashboard after authentication |
| `http://localhost:8000/docs` | FastAPI Swagger UI |
| `http://localhost:8000/health` | Health check |

## Local Setup

### Prerequisites

- Node.js 18 or newer
- npm
- Python 3.10 or newer

### Backend

The backend defaults to a local SQLite database file at `backend/hawkeye.db` when started from the `backend` folder.

```bash
git clone https://github.com/Karthik-kumar-m/Hawkeye.git
cd Hawkeye

python -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt

cd backend
uvicorn main:app --reload --port 8000
```

To use PostgreSQL instead of SQLite:

```bash
export DATABASE_URL="postgresql+asyncpg://<user>:<password>@localhost/<database_name>"
cd backend
uvicorn main:app --reload --port 8000
```

### Frontend

The Vite dev server proxies `/api` and `/ws` requests to the backend on port 8000.

```bash
cd frontend
npm install
npm run dev
```

## Typical Workflow

### Teacher workflow

1. Open `http://localhost:5173/` and switch to Teacher Login.
2. Register or sign in with teacher credentials.
3. Preview the student USN PDF to validate extracted IDs.
4. Preview the question source to confirm parsed questions and answer keys.
5. Upload the exam PDF, USN roster PDF, title, test ID, and duration.
6. Monitor active sessions, violations, and completion events in real time.
7. Review results, scores, trust scores, and event timelines in the teacher dashboard.

### Student workflow

1. Open `http://localhost:5173/` and stay in Student Login mode.
2. Enter the approved USN and the teacher-issued test ID.
3. Review the live schedule panel to confirm whether the exam is upcoming, live, or closed.
4. Start or resume the exam session.
5. Complete the exam while Hawkeye tracks integrity events in the background.

## API Surface

### Auth endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/auth/teachers/register` | Create a teacher account |
| `POST` | `/api/v1/auth/teachers/login` | Authenticate a teacher |
| `POST` | `/api/v1/auth/students/register` | Create a student account |
| `POST` | `/api/v1/auth/students/login` | Authenticate a student |

### Test endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/tests/preview-usns` | Preview parsed student USNs from roster PDF |
| `POST` | `/api/v1/tests/preview-questions` | Preview parsed questions from PDF or structured text |
| `POST` | `/api/v1/tests/upload` | Create a test, parse questions, and grant student access |
| `GET` | `/api/v1/tests/` | List uploaded tests |
| `GET` | `/api/v1/tests/{test_id}` | Fetch one test by code |
| `GET` | `/api/v1/tests/{test_id}/schedule` | Public schedule lookup for login page |
| `GET` | `/api/v1/tests/{test_id}/questions` | Fetch parsed questions for teacher review |

### Session endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/sessions/start` | Validate student access and create or resume a session |
| `GET` | `/api/v1/sessions/` | List sessions with trust, score, and violation counts |
| `POST` | `/api/v1/sessions/{session_id}/complete` | Mark a session complete |
| `GET` | `/api/v1/sessions/{session_id}/summary` | Fetch session summary and grading data |
| `GET` | `/api/v1/sessions/{session_id}/events` | Fetch recent session timeline events |

### Resource endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/resources/` | List all configured external resources |
| `POST` | `/api/v1/resources/` | Add an external resource |
| `DELETE` | `/api/v1/resources/{resource_id}` | Remove an external resource |

### WebSocket endpoints

| Path | Description |
|------|-------------|
| `/ws/student/{session_id}` | Student client sends tracking events |
| `/ws/admin/{admin_id}` | Teacher dashboard receives live monitoring events |

## Project Structure

```text
Hawkeye/
├── backend/
│   ├── main.py
│   ├── database.py
│   ├── models.py
│   ├── schemas.py
│   ├── ws_manager.py
│   ├── uploads/
│   └── routers/
│       ├── auth.py
│       ├── resources.py
│       ├── sessions.py
│       ├── tests.py
│       └── ws.py
├── frontend/
│   ├── index.html
│   ├── package.json
│   ├── vite.config.js
│   └── src/
│       ├── App.jsx
│       ├── index.css
│       ├── main.jsx
│       └── components/
│           ├── ExamView.jsx
│           ├── Login.jsx
│           ├── ResourceModal.jsx
│           └── TeacherPortal.jsx
└── README.md
```

## Useful Commands

```bash
# frontend
cd frontend
npm run dev
npm run build
npm run preview
npm run lint
```

```bash
# backend
cd backend
uvicorn main:app --reload --port 8000
```

```bash
# restart backend from repo root
lsof -ti :8000 | xargs -r kill -9
cd backend
source ../.venv/bin/activate
uvicorn main:app --reload --port 8000
```

## Notes

- The backend creates tables automatically on startup for local development.
- Uploaded PDFs are served from `/uploads/tests/...`.
- Question scoring works best when the parser can detect options `A` through `D` and a `correct_option` line.
- The dev setup currently assumes the backend is available on `127.0.0.1:8000` for Vite proxying.