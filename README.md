# Hawkeye

Hawkeye is an integrity-focused exam platform for managing timed tests, admitting only approved students, tracking exam activity in real time, and surfacing results, trust scores, and violation timelines in a teacher dashboard.

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