// ─────────────────────────────────────────────────────────────────────────────
// WhiteboardImageFrameDialog — position + zoom an uploaded image to fit the
// whiteboard canvas, then export the framed result as a JPEG Blob the
// caller uploads to Supabase Storage.
//
// Mirrors CropDialog.jsx — same react-easy-crop pattern, same blob-export
// path — but parameterizes the aspect ratio from the live canvas's
// width/height instead of hardcoding 16:9. The whiteboard's aspect varies
// (iPad portrait vs. landscape jumbotron vs. desktop), and the framing
// step needs to match so the image fills the board without letterbox or
// crop surprise on first render.
//
// Design decision (Commit 1): the framed result is uploaded as a single
// cropped JPEG. No runtime transform-state persistence — the file IS the
// framing. Reopening on a different-aspect viewport may letterbox a bit,
// but the coach can re-upload to re-frame. Commit 2 (per-program image
// library) can revisit if real coach usage demands a stored transform.
//
// PROPS
//   file       — File from the <input type="file"> change event.
//   aspect     — number (width/height) of the target canvas. Computed by
//                the caller from containerRef.clientWidth / clientHeight
//                at dialog-mount time.
//   orgColor   — for the primary button + slider accent.
//   onCancel() — close without uploading.
//   onConfirm(framedBlob) — fires when the coach taps "Use this image".
//                Blob is JPEG, ~88 % quality, dimensions matching the
//                framed pixel rect at native resolution (no upscaling).
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from 'react'
import Cropper from 'react-easy-crop'

const OUTPUT_MIME = 'image/jpeg'
const OUTPUT_QUALITY = 0.88

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload  = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload  = () => resolve(img)
    img.onerror = () => reject(new Error('Could not decode image'))
    img.src     = dataUrl
  })
}

// Render the cropped rectangle out to a JPEG Blob. pixelCrop is in
// source-image pixels; the output canvas matches those exact dims so we
// neither up- nor down-sample.
async function cropToBlob(dataUrl, pixelCrop) {
  const img = await loadImage(dataUrl)
  const canvas = document.createElement('canvas')
  canvas.width  = pixelCrop.width
  canvas.height = pixelCrop.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas not supported in this browser')
  // White underfill so any alpha in the source becomes white (matches the
  // whiteboard's Blank background, which is where eraser strokes punch
  // through to).
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(
    img,
    pixelCrop.x, pixelCrop.y, pixelCrop.width, pixelCrop.height,
    0, 0,                    pixelCrop.width, pixelCrop.height,
  )
  return await new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => blob ? resolve(blob) : reject(new Error('Could not export framed image')),
      OUTPUT_MIME,
      OUTPUT_QUALITY,
    )
  })
}

export default function WhiteboardImageFrameDialog({
  file,
  aspect = 16 / 9,
  orgColor = '#cc1111',
  onCancel,
  onConfirm,
}) {
  const [dataUrl,   setDataUrl]   = useState(null)
  const [readErr,   setReadErr]   = useState('')
  const [crop,      setCrop]      = useState({ x: 0, y: 0 })
  const [zoom,      setZoom]      = useState(1)
  const [pixelCrop, setPixelCrop] = useState(null)
  const [working,   setWorking]   = useState(false)
  const [err,       setErr]       = useState('')

  // Bound aspect so unusual viewports (e.g. very tall portrait split-view)
  // still give the coach a usable framing area. Falls back gracefully if
  // the caller passes a non-finite value.
  const safeAspect =
    Number.isFinite(aspect) && aspect > 0
      ? Math.min(3, Math.max(0.5, aspect))
      : 16 / 9

  useEffect(() => {
    if (!file) return
    let cancelled = false
    fileToDataUrl(file)
      .then(url => { if (!cancelled) setDataUrl(url) })
      .catch(e   => { if (!cancelled) setReadErr(e?.message ?? 'Could not read image') })
    return () => { cancelled = true }
  }, [file])

  const onCropComplete = useCallback((_area, areaPx) => {
    setPixelCrop(areaPx)
  }, [])

  async function handleConfirm() {
    if (!dataUrl || !pixelCrop) return
    setWorking(true); setErr('')
    try {
      const blob = await cropToBlob(dataUrl, pixelCrop)
      onConfirm?.(blob)
    } catch (e) {
      console.error('[WhiteboardImageFrameDialog] crop failed:', e?.message ?? e)
      setErr(e?.message ?? 'Could not export the framed image. Try a different file.')
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
          <h3 className="font-bold text-white text-lg">Frame the image</h3>
          <p className="text-xs leading-relaxed" style={{ color: '#9a8080' }}>
            Drag to position, slide to zoom. The framed area fills the
            whiteboard; you can draw on top with pen tools afterward.
          </p>
        </div>

        {/* react-easy-crop owns the layout. We pin the parent to the
            whiteboard's live aspect so what the coach frames is what
            ends up on the board. */}
        <div
          className="relative w-full rounded-xl overflow-hidden"
          style={{
            aspectRatio:     String(safeAspect),
            backgroundColor: '#0a0000',
            border:          '1px solid #2a0000',
          }}
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
              aspect={safeAspect}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={onCropComplete}
              minZoom={1}
              maxZoom={4}
              objectFit="contain"
              showGrid={false}
              restrictPosition={false}
            />
          )}
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: '#9a8080' }}>
            Zoom
          </span>
          <input
            type="range"
            min={1}
            max={4}
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
            {working ? 'Saving…' : 'Use this image'}
          </button>
        </div>
      </div>
    </div>
  )
}
