import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { ShieldCheck, Settings, LogOut } from 'lucide-react'
import ResourceModal from './ResourceModal'

const API = '/api/v1/resources'
const SESSIONS_API = '/api/v1/sessions/'
const WS_BASE = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}`

/**
 * Circular SVG trust-score ring.
 * Green > 80 | Yellow 50-80 | Red < 50
 */
function TrustRing({ score }) {
  const r = 18
  const circ = 2 * Math.PI * r
  const offset = circ - (score / 100) * circ
  const color =
    score > 80 ? '#16a34a' : score >= 50 ? '#d97706' : '#dc2626'

  return (
    <svg width="48" height="48" viewBox="0 0 48 48">
      {/* Track */}
      <circle cx="24" cy="24" r={r} fill="none" stroke="#e5e7eb" strokeWidth="4" />
      {/* Progress */}
      <circle
        cx="24"
        cy="24"
        r={r}
        fill="none"
        stroke={color}
        strokeWidth="4"
        strokeDasharray={circ}
        strokeDashoffset={offset}
        strokeLinecap="round"
        transform="rotate(-90 24 24)"
        style={{ transition: 'stroke-dashoffset 0.5s ease' }}
      />
      <text x="24" y="28" textAnchor="middle" fontSize="10" fontWeight="bold" fill={color}>
        {score}
      </text>
    </svg>
  )
}

/** Status pill badge */
function StatusBadge({ status }) {
  const active = status === 'active'
  return (
    <span
      className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${
        active ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'
      }`}
    >
      {active ? 'Active' : 'Completed'}
    </span>
  )
}

/**
 * AuditorDashboard – Real-time monitoring view for admins.
 *
 * WebSocket lifecycle:
 *   - Connects to /ws/admin/{adminId} on mount.
 *   - Incoming JSON messages update the matching session row in state
 *     (trust_score, event counters) without a full page refresh.
 *   - Disconnects cleanly on unmount.
 */
export default function AuditorDashboard() {
  const navigate = useNavigate()
  const adminId = sessionStorage.getItem('adminId') || `admin-${Date.now()}`

  const [sessions, setSessions] = useState([])

  const [resources, setResources] = useState([])
  const [showModal, setShowModal] = useState(false)
  const [selectedSession, setSelectedSession] = useState(null)
  const [timelineBySession, setTimelineBySession] = useState({})
  const wsRef = useRef(null)

  const upsertTimelineEvent = (sessionId, event) => {
    setTimelineBySession((prev) => {
      const current = prev[sessionId] || []
      const exists = current.some((item) => item.id === event.id)
      if (exists) return prev
      const updated = [event, ...current].slice(0, 200)
      return { ...prev, [sessionId]: updated }
    })
  }

  const formatEventLabel = (eventType) => eventType.replaceAll('_', ' ').toLowerCase()

  const formatPayloadValue = (value) => {
    if (value === null || value === undefined) return '-'
    if (typeof value === 'object') return JSON.stringify(value)
    return String(value)
  }

  // --- Load resources -------------------------------------------------------
  useEffect(() => {
    fetch(API)
      .then((r) => r.json())
      .then(setResources)
      .catch(() => {})
  }, [])

  useEffect(() => {
    fetch(SESSIONS_API)
      .then((r) => r.json())
      .then((data) => {
        const normalized = data.map((item) => ({
          id: item.id,
          studentName: item.student_name,
          studentId: item.student_identifier,
          startedAt: item.started_at,
          status: item.status,
          trustScore: item.trust_score,
          violations: item.violations,
        }))
        setSessions(normalized)
      })
      .catch(() => {})
  }, [])

  // --- WebSocket setup -------------------------------------------------------
  useEffect(() => {
    const ws = new WebSocket(`${WS_BASE}/ws/admin/${adminId}`)
    wsRef.current = ws

    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data)
        const {
          session_id,
          event_id,
          event_type,
          trust_score,
          session_status,
          payload,
          event_timestamp,
        } = msg

        if (session_id && event_type) {
          upsertTimelineEvent(session_id, {
            id: event_id || `${session_id}-${event_type}-${Date.now()}`,
            eventType: event_type,
            payload: payload || {},
            timestamp: event_timestamp || new Date().toISOString(),
          })
        }

        setSessions((prev) =>
          {
            const existing = prev.find((s) => s.id === session_id)

            if (!existing) {
              return [
                {
                  id: session_id,
                  studentName: payload?.student_name || 'Unknown Student',
                  studentId: payload?.student_identifier || 'N/A',
                  startedAt: new Date().toISOString(),
                  status: session_status || 'active',
                  trustScore: trust_score ?? 100,
                  violations: event_type === 'VIOLATION_DETECTED' ? 1 : 0,
                },
                ...prev,
              ]
            }

            return prev.map((s) => {
              if (s.id !== session_id) return s
              const isViolation = event_type === 'VIOLATION_DETECTED'
              return {
                ...s,
                status: session_status || s.status,
                trustScore: trust_score !== null && trust_score !== undefined ? trust_score : s.trustScore,
                violations: isViolation ? s.violations + 1 : s.violations,
              }
            })
          }
        )
      } catch {
        // ignore malformed messages
      }
    }

    ws.onerror = () => console.warn('Admin WS failed – backend may be offline')

    return () => ws.close()
  }, [adminId])

  // --- Resource CRUD --------------------------------------------------------
  const handleAddResource = async (title, url) => {
    const res = await fetch(API + '/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, url, is_active: true }),
    })
    if (res.ok) {
      const created = await res.json()
      setResources((prev) => [...prev, created])
    }
  }

  const handleDeleteResource = async (id) => {
    await fetch(`${API}/${id}`, { method: 'DELETE' })
    setResources((prev) => prev.filter((r) => r.id !== id))
  }

  // --- Derived metrics -------------------------------------------------------
  const totalSessions = sessions.length
  const activeSessions = sessions.filter((s) => s.status === 'active').length
  const totalViolations = sessions.reduce((sum, s) => sum + s.violations, 0)
  const totalStudents = new Set(sessions.map((s) => s.studentId)).size

  const handleLogout = () => {
    sessionStorage.clear()
    navigate('/admin')
  }

  useEffect(() => {
    if (!selectedSession) return
    const refreshed = sessions.find((s) => s.id === selectedSession.id)
    if (refreshed) {
      setSelectedSession(refreshed)
    }
  }, [selectedSession, sessions])

  useEffect(() => {
    if (!selectedSession) return

    fetch(`${SESSIONS_API}${selectedSession.id}/events`)
      .then((r) => {
        if (!r.ok) {
          throw new Error('Failed to load session timeline')
        }
        return r.json()
      })
      .then((data) => {
        const timeline = data.map((item) => ({
          id: item.id,
          eventType: item.event_type,
          payload: item.payload || {},
          timestamp: item.timestamp,
        }))
        setTimelineBySession((prev) => ({ ...prev, [selectedSession.id]: timeline }))
      })
      .catch(() => {})
  }, [selectedSession])

  const selectedTimeline = selectedSession ? timelineBySession[selectedSession.id] || [] : []

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top nav */}
      <header className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className="text-blue-700" size={22} />
            <span className="font-bold text-slate-800 text-sm tracking-wide">
              AUDITOR DASHBOARD
            </span>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowModal(true)}
              className="flex items-center gap-1.5 text-sm text-blue-700 border border-blue-200 hover:bg-blue-50 px-3 py-1.5 rounded-md transition-colors"
            >
              <Settings size={14} />
              Manage Resources
            </button>
            <button
              onClick={handleLogout}
              className="flex items-center gap-1.5 text-sm text-slate-600 hover:text-red-600 px-3 py-1.5 rounded-md transition-colors"
            >
              <LogOut size={14} />
              Logout
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        {/* Metrics row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
          {[
            { label: 'Total Sessions', value: totalSessions },
            { label: 'Active Exams', value: activeSessions },
            { label: 'Total Violations', value: totalViolations },
            { label: 'Total Students', value: totalStudents },
          ].map(({ label, value }) => (
            <div
              key={label}
              className="bg-white shadow-sm rounded-lg p-5 border border-slate-100"
            >
              <p className="text-xs text-slate-500 uppercase tracking-wide">{label}</p>
              <p className="text-3xl font-bold text-slate-800 mt-1">{value}</p>
            </div>
          ))}
        </div>

        {/* Session table */}
        <div className="bg-white shadow-sm rounded-lg border border-slate-100 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100">
            <h2 className="text-base font-semibold text-slate-800">Exam Sessions</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wide">
                <tr>
                  <th className="text-left px-6 py-3">Student</th>
                  <th className="text-left px-6 py-3">Student ID</th>
                  <th className="text-left px-6 py-3">Started At</th>
                  <th className="text-left px-6 py-3">Status</th>
                  <th className="text-left px-6 py-3">Trust Score</th>
                  <th className="text-left px-6 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sessions.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4 font-medium text-slate-800">{s.studentName}</td>
                    <td className="px-6 py-4 text-slate-500">{s.studentId}</td>
                    <td className="px-6 py-4 text-slate-500">
                      {new Date(s.startedAt).toLocaleTimeString()}
                    </td>
                    <td className="px-6 py-4">
                      <StatusBadge status={s.status} />
                    </td>
                    <td className="px-6 py-4">
                      <TrustRing score={s.trustScore} />
                    </td>
                    <td className="px-6 py-4">
                      <button
                        onClick={() =>
                          setSelectedSession(selectedSession?.id === s.id ? null : s)
                        }
                        className="text-xs font-semibold text-blue-700 border border-blue-200 hover:bg-blue-50 px-3 py-1.5 rounded-md transition-colors"
                      >
                        VIEW DETAILS
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Inline session details panel */}
        {selectedSession && (
          <div className="mt-6 bg-white shadow-sm rounded-lg border border-slate-100 p-6">
            <h3 className="text-base font-semibold text-slate-800 mb-3">
              Session Details – {selectedSession.studentName}
            </h3>
            <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
              <div>
                <dt className="text-slate-500">Student ID</dt>
                <dd className="font-medium text-slate-800">{selectedSession.studentId}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Status</dt>
                <dd>
                  <StatusBadge status={selectedSession.status} />
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Trust Score</dt>
                <dd className="font-medium text-slate-800">{selectedSession.trustScore}%</dd>
              </div>
              <div>
                <dt className="text-slate-500">Violations</dt>
                <dd className="font-medium text-red-600">{selectedSession.violations}</dd>
              </div>
            </dl>

            <div className="mt-6 border-t border-slate-100 pt-5">
              <h4 className="text-sm font-semibold text-slate-800 mb-3">Violation Timeline</h4>

              {selectedTimeline.length === 0 ? (
                <p className="text-sm text-slate-500">No events logged for this session yet.</p>
              ) : (
                <div className="max-h-80 overflow-y-auto space-y-3 pr-2">
                  {selectedTimeline.map((event) => (
                    <div
                      key={event.id}
                      className="rounded-md border border-slate-200 bg-slate-50 p-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-700">
                          {formatEventLabel(event.eventType)}
                        </p>
                        <p className="text-xs text-slate-500">
                          {new Date(event.timestamp).toLocaleString()}
                        </p>
                      </div>

                      {Object.keys(event.payload || {}).length === 0 ? (
                        <p className="text-xs text-slate-500">No payload details.</p>
                      ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                          {Object.entries(event.payload).map(([key, value]) => (
                            <div key={key} className="rounded bg-white px-2 py-1 border border-slate-200">
                              <span className="font-medium text-slate-600">{key}: </span>
                              <span className="text-slate-800">{formatPayloadValue(value)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* Resources modal */}
      {showModal && (
        <ResourceModal
          onClose={() => setShowModal(false)}
          resources={resources}
          onAdd={handleAddResource}
          onDelete={handleDeleteResource}
        />
      )}
    </div>
  )
}
