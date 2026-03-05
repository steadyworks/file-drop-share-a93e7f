'use client'

import { useState, useRef, DragEvent } from 'react'

const API_BASE = 'http://localhost:3001'
const MAX_BYTES = 10 * 1024 * 1024

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function UploadPage() {
  const [file, setFile] = useState<File | null>(null)
  const [pin, setPin] = useState('')
  const [expiry, setExpiry] = useState('1h')
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [shareUrl, setShareUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileSelect = (selected: File) => {
    setShareUrl(null)
    setFile(selected)
    if (selected.size > MAX_BYTES) {
      setError('File exceeds the 10 MB limit.')
    } else {
      setError(null)
    }
  }

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    const f = e.dataTransfer.files[0]
    if (f) handleFileSelect(f)
  }

  const handleUpload = () => {
    if (!file) {
      setError('Please select a file.')
      return
    }
    if (file.size > MAX_BYTES) {
      setError('File exceeds the 10 MB limit.')
      return
    }

    setUploading(true)
    setProgress(0)
    setError(null)

    const formData = new FormData()
    formData.append('file', file)
    formData.append('pin', pin)
    formData.append('expiry', expiry)

    const xhr = new XMLHttpRequest()

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        setProgress(Math.round((e.loaded / e.total) * 100))
      }
    })

    xhr.addEventListener('load', () => {
      setUploading(false)
      if (xhr.status >= 200 && xhr.status < 300) {
        const data = JSON.parse(xhr.responseText)
        setShareUrl(`${window.location.origin}/d/${data.slug}`)
      } else {
        let msg = 'Upload failed. Please try again.'
        try {
          const data = JSON.parse(xhr.responseText)
          if (data.error) msg = data.error
        } catch {}
        setError(msg)
      }
    })

    xhr.addEventListener('error', () => {
      setUploading(false)
      setError('Network error. Please try again.')
    })

    xhr.open('POST', `${API_BASE}/api/upload`)
    xhr.send(formData)
  }

  const copyLink = () => {
    if (shareUrl) {
      navigator.clipboard.writeText(shareUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <div className="w-full max-w-md">
        <h1 className="text-3xl font-bold text-center mb-8 text-gray-800">
          File Drop Share
        </h1>

        {!shareUrl ? (
          <div className="bg-white rounded-2xl shadow-md p-8 space-y-6">
            {/* Dropzone */}
            <div
              data-testid="dropzone"
              className="border-2 border-dashed border-gray-300 rounded-xl p-10 text-center cursor-pointer hover:border-blue-400 transition-colors"
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
            >
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) handleFileSelect(f)
                }}
              />
              {file ? (
                <div>
                  <p data-testid="selected-file-name" className="font-medium text-gray-800 truncate">
                    {file.name}
                  </p>
                  <p data-testid="selected-file-size" className="text-sm text-gray-500 mt-1">
                    {formatSize(file.size)}
                  </p>
                </div>
              ) : (
                <div>
                  <p className="text-gray-500">Drag & drop a file here, or click to select</p>
                  <p className="text-sm text-gray-400 mt-1">Max size: 10 MB</p>
                </div>
              )}
            </div>

            {/* PIN */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                PIN (optional)
              </label>
              <input
                data-testid="pin-input"
                type="text"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                placeholder="Leave blank for no PIN"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>

            {/* Expiry */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Expiry
              </label>
              <select
                data-testid="expiry-select"
                value={expiry}
                onChange={(e) => setExpiry(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              >
                <option value="10s">10 seconds (testing)</option>
                <option value="10m">10 minutes</option>
                <option value="1h">1 hour</option>
                <option value="24h">24 hours</option>
              </select>
            </div>

            {/* Progress bar — always in DOM, visibility toggled so Playwright can detect it */}
            <div
              data-testid="upload-progress"
              className={`w-full bg-gray-200 rounded-full h-3 overflow-hidden ${uploading ? 'visible' : 'invisible'}`}
            >
              <div
                className="bg-blue-500 h-3 rounded-full transition-all duration-200"
                style={{ width: `${progress}%` }}
              />
            </div>

            {/* Error */}
            {error && (
              <p data-testid="upload-error" className="text-red-500 text-sm">
                {error}
              </p>
            )}

            {/* Upload button */}
            <button
              data-testid="upload-btn"
              onClick={handleUpload}
              disabled={uploading}
              className="w-full bg-blue-500 hover:bg-blue-600 disabled:bg-gray-300 text-white font-medium py-2.5 px-4 rounded-lg transition-colors"
            >
              {uploading ? 'Uploading…' : 'Upload'}
            </button>
          </div>
        ) : (
          <div className="bg-white rounded-2xl shadow-md p-8 space-y-4">
            <h2 className="text-xl font-semibold text-gray-800">File uploaded!</h2>
            <p className="text-sm text-gray-600">Share this link:</p>
            <input
              data-testid="share-link"
              readOnly
              value={shareUrl}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-gray-50"
            />
            <button
              data-testid="copy-link-btn"
              onClick={copyLink}
              className="w-full bg-green-500 hover:bg-green-600 text-white font-medium py-2.5 px-4 rounded-lg transition-colors"
            >
              {copied ? 'Copied!' : 'Copy link'}
            </button>
          </div>
        )}
      </div>
    </main>
  )
}
