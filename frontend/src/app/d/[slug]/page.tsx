'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'

const API_BASE = 'http://localhost:3001'

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatCountdown(seconds: number): string {
  if (seconds <= 0) return 'Expired'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) return `${h}h ${m}m ${s}s`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

type FileInfo = {
  slug: string
  filename: string
  size: number
  expires_at: string
  has_pin: boolean
}

type Status = 'loading' | 'not_found' | 'expired' | 'available'

export default function DownloadPage() {
  const params = useParams()
  const slug = params.slug as string

  const [status, setStatus] = useState<Status>('loading')
  const [fileInfo, setFileInfo] = useState<FileInfo | null>(null)
  const [pinInput, setPinInput] = useState('')
  const [pinError, setPinError] = useState(false)
  const [pinVerified, setPinVerified] = useState(false)
  const [verifiedPin, setVerifiedPin] = useState('')
  const [secondsLeft, setSecondsLeft] = useState(0)

  useEffect(() => {
    fetch(`${API_BASE}/api/files/${slug}`)
      .then((res) => {
        if (res.status === 404) {
          setStatus('not_found')
          return null
        }
        if (res.status === 410) {
          setStatus('expired')
          return null
        }
        return res.json()
      })
      .then((data) => {
        if (!data) return
        setFileInfo(data)
        const now = Date.now()
        const expiresAt = new Date(data.expires_at).getTime()
        setSecondsLeft(Math.max(0, Math.floor((expiresAt - now) / 1000)))
        setStatus('available')
        if (!data.has_pin) {
          setPinVerified(true)
        }
      })
      .catch(() => setStatus('not_found'))
  }, [slug])

  // Countdown: each tick schedules the next decrement
  useEffect(() => {
    if (status !== 'available') return
    if (secondsLeft <= 0) {
      setStatus('expired')
      return
    }
    const timer = setTimeout(() => {
      setSecondsLeft((s) => Math.max(0, s - 1))
    }, 1000)
    return () => clearTimeout(timer)
  }, [status, secondsLeft])

  const handleVerifyPin = async () => {
    const res = await fetch(`${API_BASE}/api/files/${slug}/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: pinInput }),
    })
    const data = await res.json()
    if (data.valid) {
      setVerifiedPin(pinInput)
      setPinVerified(true)
      setPinError(false)
    } else {
      setPinError(true)
    }
  }

  if (status === 'loading') {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="text-gray-500">Loading…</p>
      </main>
    )
  }

  if (status === 'not_found') {
    return (
      <main className="flex min-h-screen items-center justify-center p-8">
        <div className="text-center space-y-3">
          <p data-testid="not-found-message" className="text-xl font-semibold text-gray-700">
            File not found.
          </p>
          <p className="text-sm text-gray-500">This link does not exist.</p>
        </div>
      </main>
    )
  }

  if (status === 'expired') {
    return (
      <main className="flex min-h-screen items-center justify-center p-8">
        <div className="text-center space-y-3">
          <p data-testid="expired-message" className="text-xl font-semibold text-gray-700">
            This link has expired.
          </p>
          <p className="text-sm text-gray-500">The file is no longer available.</p>
        </div>
      </main>
    )
  }

  if (!fileInfo) return null

  const downloadUrl =
    fileInfo.has_pin && verifiedPin
      ? `${API_BASE}/api/files/${slug}/download?pin=${encodeURIComponent(verifiedPin)}`
      : `${API_BASE}/api/files/${slug}/download`

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-md p-8 space-y-4">
        <h1 data-testid="file-name" className="text-xl font-semibold text-gray-800 break-all">
          {fileInfo.filename}
        </h1>
        <p data-testid="file-size" className="text-sm text-gray-500">
          {formatSize(fileInfo.size)}
        </p>
        <p data-testid="expiry-countdown" className="text-sm font-mono text-orange-500">
          Expires in: {formatCountdown(secondsLeft)}
        </p>

        {fileInfo.has_pin && !pinVerified && (
          <div className="space-y-3 pt-2">
            <p className="text-sm text-gray-600 font-medium">This file is PIN-protected.</p>
            <input
              data-testid="pin-input"
              type="text"
              value={pinInput}
              onChange={(e) => setPinInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleVerifyPin()}
              placeholder="Enter PIN"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
            {pinError && (
              <p data-testid="pin-error" className="text-red-500 text-sm">
                Incorrect PIN. Please try again.
              </p>
            )}
            <button
              data-testid="pin-submit"
              onClick={handleVerifyPin}
              className="w-full bg-blue-500 hover:bg-blue-600 text-white font-medium py-2 px-4 rounded-lg transition-colors"
            >
              Submit PIN
            </button>
          </div>
        )}

        {pinVerified && (
          <a
            data-testid="download-btn"
            href={downloadUrl}
            className="block w-full bg-green-500 hover:bg-green-600 text-white font-medium py-2.5 px-4 rounded-lg text-center transition-colors mt-4"
          >
            Download
          </a>
        )}
      </div>
    </main>
  )
}
