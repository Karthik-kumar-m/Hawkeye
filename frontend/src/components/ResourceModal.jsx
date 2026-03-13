import { useState } from 'react'
import { X } from 'lucide-react'

/**
 * ResourceModal – Admin overlay for managing external resources.
 * Props:
 *   onClose  – callback to hide the modal
 *   resources – current list of ExternalResource objects
 *   onAdd    – async callback(title, url) to create a new resource
 *   onDelete – async callback(id) to delete a resource
 */
export default function ResourceModal({ onClose, resources, onAdd, onDelete }) {
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')
  const [adding, setAdding] = useState(false)

  const handleAdd = async (e) => {
    e.preventDefault()
    if (!title.trim() || !url.trim()) return
    setAdding(true)
    await onAdd(title.trim(), url.trim())
    setTitle('')
    setUrl('')
    setAdding(false)
  }

  return (
    /* Overlay */
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg p-6 relative">
        {/* Close */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-slate-600"
        >
          <X size={20} />
        </button>

        <h2 className="text-lg font-bold text-slate-800 mb-5">Manage Resources</h2>

        {/* Add form */}
        <form onSubmit={handleAdd} className="space-y-3 mb-6">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="MDN Web Docs"
              required
              className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">URL</label>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://developer.mozilla.org"
              required
              className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <button
            type="submit"
            disabled={adding}
            className="bg-blue-700 hover:bg-blue-800 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-md transition-colors"
          >
            {adding ? 'Adding…' : 'Add Resource'}
          </button>
        </form>

        {/* Current resources list */}
        <h3 className="text-sm font-semibold text-slate-700 mb-2">Current Resources</h3>
        {resources.length === 0 ? (
          <p className="text-sm text-slate-400">No resources added yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100 max-h-60 overflow-y-auto">
            {resources.map((r) => (
              <li key={r.id} className="flex items-center justify-between py-2">
                <div>
                  <p className="text-sm font-medium text-slate-700">{r.title}</p>
                  <a
                    href={r.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-600 hover:underline truncate max-w-xs block"
                  >
                    {r.url}
                  </a>
                </div>
                <button
                  onClick={() => onDelete(r.id)}
                  className="ml-4 text-red-500 hover:text-red-700 text-xs font-medium"
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-5 flex justify-end">
          <button
            onClick={onClose}
            className="text-sm text-slate-500 hover:text-slate-700 border border-slate-200 px-4 py-2 rounded-md transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
