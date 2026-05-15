// ─────────────────────────────────────────────────────────────────────────────
// CropDialog — 16:9 crop + zoom for the practice screen background upload.
//
// Coaches upload arbitrary-aspect images. Without a crop step they got
// awkward letterboxing or center-cropped framing. This modal opens
// between file-pick and the actual Supabase Storage upload, runs the
// image through react-easy-crop so the coach can drag-to-position +
// pinch/scroll to zoom, then exports the chosen rectangle as a JPEG
// Blob the existing upload code consumes.
//
// PROPS
//   file       — File from the <input type="file"> change event.
//   onCancel() — close without uploading. The parent must clear the
//                file-input ref so picking the same file again refires
//                the change event.
//   onConfirm(croppedBlob) — fires once the coach taps Save. Blob is
//                JPEG, ~85% quality, dimensions matching the source's
//                cropped pixel rect (no upscaling — if the coach zoomed
//                in past 1× the output is still the original
//                resolution at that zoom). Parent calls the existing
//                Supabase upload path with this Blob in place of the
//                File.
//   orgColor   — for the primary button.
//
// FALLBACK
//   The 16:9 aspect is fixed. If canvas.toBlob errors (very old
//   Safari, etc.) we surface the error inline; the parent can fall
//   back to uploading the original file unchanged. We do NOT silently
//   upload — coaches should see the failure rather than get a
//   surprise-framed image.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from 'react'
import Cropper from 'react-easy-crop'

const ASPECT = 16 / 9
const OUTPUT_MIME = 'image/jpeg'
const OUTPUT_QUALITY = 0.85

// Read a File into a data URL the <img> tag (and react-easy-crop) can render.
function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload  = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })
}

// Load an <img> element from a data URL. Wrapped in a Promise so we can
// await the natural-size metadata before drawing to canvas.
function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload  = () => resolve(img)
    img.onerror = () => reject(new Error('Could not decode image'))
    img.src     = dataUrl
  })
}

// Crop the source image to the rectangle react-easy-crop's
// onCropComplete handed us, return as a JPEG Blob.
async function cropToBlob(dataUrl, pixelCrop) {
  const img = await loadImage(dataUrl)
  const canvas = document.createElement('canvas')
  canvas.width  = pixelCrop.width
  canvas.height = pixelCrop.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas not supported in this browser')
  ctx.drawImage(
    img,
    pixelCrop.x, pixelCrop.y, pixelCrop.width, pixelCrop.height,
    0, 0,                    pixelCrop.width, pixelCrop.height,
  )
  return await new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => blob ? resolve(blob) : reject(new Error('Could not export cropped image')),
      OUTPUT_MIME,
      OUTPUT_QUALITY,
    )
  })
}

export default function CropDialog({ file, onCancel, onConfirm, orgColor = '#cc1111' }) {
  const [dataUrl,   setDataUrl]   = useState(null)
  const [readErr,   setReadErr]   = useState('')
  const [crop,      setCrop]      = useState({ x: 0, y: 0 })
  const [zoom,      setZoom]      = useState(1)
  const [pixelCrop, setPixelCrop] = useState(null)
  const [working,   setWorking]   = useState(false)
  const [err,       setErr]       = useState('')

  // Read the File into a data URL on mount. Closing the dialog clears
  // dataUrl on unmount so the GC can drop the (potentially large)
  // base64 string.
  useEffect(() => {
    if (!file) return
    let cancelled = false
    fileToDataUrl(file)
      .then(url => { if (!cancelled) setDataUrl(url) })
      .catch(e   => { if (!cancelled) setReadErr(e?.message ?? 'Could not read image') })
    return () => { cancelled = true }
  }, [file])

  const onCropComplete = useCallback((_area, areaPx) => {
    // areaPx = { x, y, width, height } in source-image pixels. That's
    // what cropToBlob wants.
    setPixelCrop(areaPx)
  }, [])

  async function handleConfirm() {
    if (!dataUrl || !pixelCrop) return
    setWorking(true); setErr('')
    try {
      const blob = await cropToBlob(dataUrl, pixelCrop)
      onConfirm?.(blob)
    } catch (e) {
      console.error('[CropDialog] crop failed:', e?.message ?? e)
      setErr(e?.message ?? 'Could not export the cropped image. Try a different file.')
    } finally {
      setWorking(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.92)' }}
    >
      <div
        className="w-full max-w-2xl rounded-2xl flex flex-col gap-4 p-5"
        style={{ backgroundColor: '#110000', border: '1px solid #2a0000' }}
      >
        <div className="flex flex-col gap-1">
          <h3 className="font-bold text-white text-lg">Frame your background</h3>
          <p className="text-xs leading-relaxed" style={{ color: '#9a8080' }}>
            Drag to position, slide to zoom. The Practice screen displays this
            16:9 crop full-bleed behind the timer.
          </p>
        </div>

        {/* Cropper canvas. react-easy-crop owns the layout — we give
            it a sized parent. 9/16 of the parent width keeps it well-
            proportioned on phone-portrait and tablet alike. */}
        <div
          className="relative w-full rounded-xl overflow-hidden"
          style={{ aspectRatio: '16/9', backgroundColor: '#0a0000', border: '1px solid #2a0000' }}
        >
          {readErr && (
            <div className="absolute inset-0 flex items-center justify-center p-6 text-center">
              <p className="text-sm" style={{ color: '#ff6666' }}>{readErr}</p>
            </div>
          )}
          {!readErr && dataUrl && (
            <Cropper
              image={dataUrl}
              crop={crop}
              zoom={zoom}
              aspect={ASPECT}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={onCropComplete}
              minZoom={1}
              maxZoom={3}
              objectFit="contain"
              showGrid
            />
          )}
        </div>

        {/* Zoom slider — duplicates react-easy-crop's pinch/scroll
            gesture for users on devices where those don't reach. */}
        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: '#9a8080' }}>
            Zoom
          </span>
          <input
            type="range"
            min={1}
            max={3}
            step={0.05}
            value={zoom}
            onChange={e => setZoom(Number(e.target.value))}
            aria-label="Zoom level"
            disabled={!dataUrl || !!readErr || working}
            className="flex-1"
            style={{ accentColor: orgColor }}
          />
          <span className="text-xs font-mono tabular-nums" style={{ color: '#9a8080', minWidth: '3ch', textAlign: 'right' }}>
            {zoom.toFixed(2)}×
          </span>
        </div>

        {err && (
          <p className="text-xs rounded-lg px-3 py-2"
             style={{ backgroundColor: '#2a0000', color: '#ff6666' }}>
            {err}
          </p>
        )}

        <div className="flex gap-3">
          <button
            onClick={onCancel}
            disabled={working}
            className="flex-1 py-3 rounded-lg text-sm font-semibold disabled:opacity-50"
            style={{ border: '1px solid #2a0000', color: '#9a8080' }}
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={working || !dataUrl || !pixelCrop || !!readErr}
            className="flex-1 py-3 rounded-lg text-sm font-bold text-white disabled:opacity-40"
            style={{ backgroundColor: orgColor }}
          >
            {working ? 'Saving…' : 'Save Background'}
          </button>
        </div>
      </div>
    </div>
  )
}
