import { test, expect, type Page, type Download } from '@playwright/test'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import * as crypto from 'crypto'

const FRONTEND = 'http://localhost:3000'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a temporary file filled with random bytes.
 * Using random content means each call produces a file that is unique and
 * verifiable by comparing bytes after download.
 */
function makeTempFile(name: string, sizeBytes: number): { filePath: string; content: Buffer } {
  const content = crypto.randomBytes(sizeBytes)
  const filePath = path.join(os.tmpdir(), name)
  fs.writeFileSync(filePath, content)
  return { filePath, content }
}

/**
 * Extract the share URL from [data-testid="share-link"].
 * The element may be an <input readonly>, an <a href="...">, or a plain text node.
 */
async function getShareUrl(page: Page): Promise<string> {
  const el = page.getByTestId('share-link')
  const tag = await el.evaluate((e: Element) => e.tagName.toLowerCase())
  if (tag === 'input') return el.inputValue()
  const href = await el.getAttribute('href')
  if (href) return href
  return (await el.innerText()).trim()
}

/**
 * Navigate to the upload page, pick a file via the hidden file input inside
 * the dropzone, configure optional PIN and expiry, click upload, and wait for
 * the share link to appear.  Returns the share URL string.
 */
async function uploadFile(
  page: Page,
  filePath: string,
  opts: { pin?: string; expiry?: string } = {},
): Promise<string> {
  await page.goto(FRONTEND)

  // Implementations commonly hide the <input type="file"> inside the dropzone;
  // setInputFiles works on hidden inputs without needing to make them visible.
  await page.locator('input[type="file"]').setInputFiles(filePath)

  // File name and size should appear in the UI after selection
  await expect(page.getByTestId('selected-file-name')).toBeVisible({ timeout: 5_000 })

  if (opts.pin) {
    await page.getByTestId('pin-input').fill(opts.pin)
  }
  if (opts.expiry) {
    await page.getByTestId('expiry-select').selectOption(opts.expiry)
  }

  await page.getByTestId('upload-btn').click()
  await expect(page.getByTestId('share-link')).toBeVisible({ timeout: 30_000 })

  return getShareUrl(page)
}

/**
 * Click [data-testid="download-btn"], wait for the browser download to
 * complete, and return the downloaded file's content as a Buffer.
 */
async function clickDownloadAndRead(page: Page): Promise<Buffer> {
  const [download]: [Download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('download-btn').click(),
  ])
  const tmpPath = await download.path()
  if (!tmpPath) throw new Error('Download path is null — download may have failed')
  return fs.readFileSync(tmpPath)
}

// ---------------------------------------------------------------------------
// TC-01: Basic upload and download
// ---------------------------------------------------------------------------

test(
  'TC-01: uploaded file can be downloaded and contents match byte-for-byte',
  async ({ page }) => {
    test.setTimeout(60_000)
    const { filePath, content } = makeTempFile('tc01-upload.bin', 1 * 1024 * 1024) // 1 MB
    const fileName = path.basename(filePath)

    await page.goto(FRONTEND)
    await page.locator('input[type="file"]').setInputFiles(filePath)

    // File name and human-readable size appear after selection
    await expect(page.getByTestId('selected-file-name')).toBeVisible({ timeout: 5_000 })
    await expect(page.getByTestId('selected-file-name')).toContainText(fileName)
    await expect(page.getByTestId('selected-file-size')).toBeVisible()

    // Leave PIN blank; leave expiry at default (1h)
    await page.getByTestId('upload-btn').click()

    // Progress bar must become visible while the upload is in flight
    await expect(page.getByTestId('upload-progress')).toBeVisible({ timeout: 10_000 })

    // Once upload completes the share link is revealed
    await expect(page.getByTestId('share-link')).toBeVisible({ timeout: 30_000 })
    const shareUrl = await getShareUrl(page)
    expect(shareUrl).toBeTruthy()
    // The URL must contain the /d/ path component that identifies a download page
    expect(shareUrl).toMatch(/\/d\//)

    // Navigate to the download page
    await page.goto(shareUrl)

    await expect(page.getByTestId('file-name')).toBeVisible()
    await expect(page.getByTestId('file-name')).toContainText(fileName)
    await expect(page.getByTestId('file-size')).toBeVisible()

    // Countdown must be visible and must update (decrease) over time
    await expect(page.getByTestId('expiry-countdown')).toBeVisible()
    const countdownBefore = await page.getByTestId('expiry-countdown').innerText()
    await page.waitForTimeout(2_000)
    const countdownAfter = await page.getByTestId('expiry-countdown').innerText()
    expect(countdownBefore).not.toBe(countdownAfter)

    // No PIN was set, so the PIN input must not be visible on the download page
    await expect(page.getByTestId('pin-input')).not.toBeVisible()

    // Download and verify contents are identical
    const downloaded = await clickDownloadAndRead(page)
    expect(downloaded).toEqual(content)
  },
  { timeout: 60_000 },
)

// ---------------------------------------------------------------------------
// TC-02: Oversized file is rejected
// ---------------------------------------------------------------------------

test(
  'TC-02: file exceeding 10 MB is rejected with an error message',
  async ({ page }) => {
    const { filePath } = makeTempFile('tc02-oversized.bin', 11 * 1024 * 1024) // 11 MB

    await page.goto(FRONTEND)
    await page.locator('input[type="file"]').setInputFiles(filePath)

    const uploadError = page.getByTestId('upload-error')

    // The error may appear immediately upon file selection (client-side validation)
    // OR after the upload button is clicked (server-side validation).
    const errorAlreadyVisible = await uploadError.isVisible()
    if (!errorAlreadyVisible) {
      const btn = page.getByTestId('upload-btn')
      // Only click if the button is still enabled; if already disabled the
      // implementation chose to block submission at the UI level.
      if (!await btn.isDisabled()) {
        await btn.click()
      }
      await expect(uploadError).toBeVisible({ timeout: 20_000 })
    }

    await expect(uploadError).toBeVisible()
    // The share link must not appear after an error
    await expect(page.getByTestId('share-link')).not.toBeVisible()
  },
  { timeout: 45_000 },
)

// ---------------------------------------------------------------------------
// TC-03: PIN-protected upload and download
// ---------------------------------------------------------------------------

test(
  'TC-03: PIN gates download and wrong PINs are rejected',
  async ({ page }) => {
    const { filePath } = makeTempFile('tc03-pinned.bin', 64 * 1024) // 64 KB

    // Upload with PIN
    const shareUrl = await uploadFile(page, filePath, { pin: 'testpin99' })

    // Navigate to the download page
    await page.goto(shareUrl)

    // PIN input must be present; download button must be hidden
    await expect(page.getByTestId('pin-input')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByTestId('download-btn')).not.toBeVisible()

    // Submit empty PIN — should show error, still no download button
    await page.getByTestId('pin-submit').click()
    await expect(page.getByTestId('pin-error')).toBeVisible({ timeout: 5_000 })
    await expect(page.getByTestId('download-btn')).not.toBeVisible()

    // Submit wrong PIN — error persists, no download button
    await page.getByTestId('pin-input').fill('wrongpin')
    await page.getByTestId('pin-submit').click()
    await expect(page.getByTestId('pin-error')).toBeVisible({ timeout: 5_000 })
    await expect(page.getByTestId('download-btn')).not.toBeVisible()

    // Submit correct PIN — error clears, download button appears
    await page.getByTestId('pin-input').fill('testpin99')
    await page.getByTestId('pin-submit').click()
    await expect(page.getByTestId('pin-error')).not.toBeVisible({ timeout: 5_000 })
    await expect(page.getByTestId('download-btn')).toBeVisible({ timeout: 5_000 })

    // Download succeeds
    const downloaded = await clickDownloadAndRead(page)
    expect(downloaded.byteLength).toBeGreaterThan(0)
  },
  { timeout: 60_000 },
)

// ---------------------------------------------------------------------------
// TC-04: Expired file shows expiry message
// ---------------------------------------------------------------------------

test(
  'TC-04: visiting a link after its TTL shows an expiry message, not the file',
  async ({ page }) => {
    test.setTimeout(90_000)
    const { filePath } = makeTempFile('tc04-short-ttl.bin', 32 * 1024) // 32 KB

    // Upload with the 10-second testing TTL
    const shareUrl = await uploadFile(page, filePath, { expiry: '10s' })

    // Wait for the TTL to elapse (10 s) plus a small buffer
    await page.waitForTimeout(15_000)

    // Navigate to the now-expired link
    await page.goto(shareUrl)

    await expect(page.getByTestId('expired-message')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByTestId('download-btn')).not.toBeVisible()
    await expect(page.getByTestId('file-name')).not.toBeVisible()
  },
  { timeout: 90_000 },
)

// ---------------------------------------------------------------------------
// TC-05: Multiple uploads each get a unique link
// ---------------------------------------------------------------------------

test(
  'TC-05: three uploads produce distinct URLs, each serving the correct file',
  async ({ page }) => {
    const fileA = makeTempFile('tc05-a.bin', 128 * 1024) // 128 KB, unique content
    const fileB = makeTempFile('tc05-b.bin', 256 * 1024) // 256 KB, unique content
    const fileC = makeTempFile('tc05-c.bin', 192 * 1024) // 192 KB, unique content

    const linkA = await uploadFile(page, fileA.filePath)
    const linkB = await uploadFile(page, fileB.filePath)
    const linkC = await uploadFile(page, fileC.filePath)

    // All three share links must be distinct
    expect(linkA).not.toBe(linkB)
    expect(linkB).not.toBe(linkC)
    expect(linkA).not.toBe(linkC)

    // Link A must deliver File A's exact bytes
    await page.goto(linkA)
    const downA = await clickDownloadAndRead(page)
    expect(downA).toEqual(fileA.content)

    // Link B must deliver File B's exact bytes
    await page.goto(linkB)
    const downB = await clickDownloadAndRead(page)
    expect(downB).toEqual(fileB.content)

    // Link C must deliver File C's exact bytes
    await page.goto(linkC)
    const downC = await clickDownloadAndRead(page)
    expect(downC).toEqual(fileC.content)
  },
  { timeout: 180_000 },
)

// ---------------------------------------------------------------------------
// TC-06: Unknown slug shows not-found message
// ---------------------------------------------------------------------------

test(
  'TC-06: an unrecognized slug shows not-found, distinct from expired',
  async ({ page }) => {
    // Use a slug that has never been created
    await page.goto(`${FRONTEND}/d/doesnotexist00`)

    await expect(page.getByTestId('not-found-message')).toBeVisible({ timeout: 10_000 })
    // Must NOT show the expired-message element (these are distinct states)
    await expect(page.getByTestId('expired-message')).not.toBeVisible()
    await expect(page.getByTestId('download-btn')).not.toBeVisible()
  },
  { timeout: 30_000 },
)
