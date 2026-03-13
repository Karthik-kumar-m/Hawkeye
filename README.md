# Hawkeye — Integrity-First Exam Monitor

A real-time exam monitoring and proctoring platform that tracks student behavior during online exams, detects violations (tab switches, right-clicks), and provides a unified teacher console for test management and live monitoring.

## Tech Stack

| Layer | Technology |
|-------|------------|
| **Frontend** | React 18, Vite, Tailwind CSS, React Router |
| **Backend** | FastAPI, Uvicorn, SQLAlchemy (async), Pydantic |
| **Database** | PostgreSQL (via asyncpg) |
| **Real-time** | WebSockets |

## Prerequisites

- [Node.js](https://nodejs.org/) (v18 or later) and npm
- [Python](https://www.python.org/) 3.10+
- [PostgreSQL](https://www.postgresql.org/) 14+

## Getting Started

### 1. Clone the Repository

```bash
git clone https://github.com/Karthik-kumar-m/Hawkeye.git
cd Hawkeye
```

### 2. Set Up PostgreSQL

Create a database for the project:

```bash
createdb hawkeye_db
```

Then update the `DATABASE_URL` in `backend/database.py` with your credentials:

```python
DATABASE_URL = "postgresql+asyncpg://<user>:<password>@localhost/hawkeye_db"
```

> **Note:** Tables are created automatically when the backend starts for the first time.

### 3. Install and Run the Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate        # On Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

The API server will be available at **http://localhost:8000**.  
Interactive API docs are at **http://localhost:8000/docs**.

### 4. Install and Run the Frontend

Open a new terminal:

```bash
cd frontend
npm install
npm run dev
```

The frontend will be available at **http://localhost:5173**.

## Usage

| URL | Description |
|-----|-------------|
| `http://localhost:5173` | Student login |
| `http://localhost:5173/teacher` | Teacher console (auth, test setup, and violations monitor) |
| `http://localhost:5173/exam` | Student exam interface (after login) |

### Student Flow

1. Open `http://localhost:5173` and enter a username to start an exam session.
2. Answer the multiple-choice questions within the 45-minute timer.
3. Violations (switching tabs, right-clicking) are detected and reduce the trust score.
4. Submit the exam when finished.

### Teacher Flow

1. Open `http://localhost:5173/teacher` and log in.
2. Upload tests, set only duration, and preview USN roster parsing.
3. Test window starts automatically at upload time and ends after the selected duration.
4. Monitor violations in real time for selected pre-created tests.
5. Manage external resources that students are allowed to access during the exam.

## Project Structure

```
Hawkeye/
├── frontend/
│   ├── src/
│   │   ├── App.jsx                 # Router setup
│   │   ├── main.jsx                # React entry point
│   │   └── components/
│   │       ├── Login.jsx           # Student login
│   │       ├── ExamView.jsx        # Exam interface with violation tracking
│   │       ├── TeacherPortal.jsx   # Teacher auth, upload, and live monitoring
│   │       └── ResourceModal.jsx   # Resource management modal
│   ├── package.json
│   ├── vite.config.js
│   └── tailwind.config.js
│
├── backend/
│   ├── main.py                     # FastAPI app and lifespan setup
│   ├── database.py                 # Async database engine and session
│   ├── models.py                   # SQLAlchemy ORM models
│   ├── schemas.py                  # Pydantic request/response schemas
│   ├── ws_manager.py               # WebSocket connection manager
│   ├── requirements.txt
│   └── routers/
│       ├── ws.py                   # WebSocket endpoints
│       └── resources.py            # REST endpoints for resources
│
└── README.md
```

## API Reference

### REST Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check |
| `GET` | `/api/v1/resources/` | List all external resources |
| `POST` | `/api/v1/resources/` | Create a new resource |
| `DELETE` | `/api/v1/resources/{resource_id}` | Delete a resource |

### WebSocket Endpoints

| Path | Description |
|------|-------------|
| `/ws/student/{session_id}` | Student sends exam events (violations, navigation, submission) |
| `/ws/admin/{monitor_id}` | Teacher console receives real-time broadcasts of student events |

## Available Scripts

### Frontend

```bash
npm run dev      # Start development server on port 5173
npm run build    # Create production build
npm run preview  # Preview production build locally
npm run lint     # Run ESLint
```

### Backend

```bash
uvicorn main:app --reload --port 8000   # Development with auto-reload
uvicorn main:app --port 8000            # Production
```

Safe restart commands (without a script):

```bash
# From project root, kill any process on 8000 and start backend again
lsof -ti :8000 | xargs -r kill -9
cd backend
source ../.venv/bin/activate
uvicorn main:app --reload --port 8000
```

Use a custom port:

```bash
PORT=8001
lsof -ti :$PORT | xargs -r kill -9
cd backend
source ../.venv/bin/activate
uvicorn main:app --reload --port $PORT
```

## License

This project is provided as-is for educational purposes.