// ─────────────────────────────────────────────────────────────────────────────
// WhiteboardImageFrameDialog — confirm how the coach wants to frame an
// uploaded image, then export the result as a JPEG Blob the caller
// uploads to Supabase Storage.
//
// Default: SHOW THE WHOLE IMAGE. The cropper's aspect ratio is set to the
// image's natural aspect ratio, so at minZoom (1×) the crop box exactly
// covers the whole image — nothing is chopped off. A portrait phone photo
// of a hand-drawn play shows top-to-bottom; a wide formation chart shows
// left-to-right.
//
// Optional: the coach can ZOOM IN (up to 4×) and PAN to focus on a sub-
// region of the image, in which case the persisted output is just that
// sub-region. Both modes produce a JPEG at native source-pixel
// resolution (no upscaling).
//
// Letterboxing happens at RENDER time, not crop time — the whiteboard
// canvas calls drawCustomImageFitted() which contain-fits the saved
// image into the canvas with white bars around the short axis. That
// means a portrait image stored at portrait aspect renders portrait on
// a landscape canvas (pillarbox), and vice-versa — content is never
// chopped post-hoc.
//
// Persistence (Commit 1): the framed JPEG IS the persisted framing — no
// runtime transform-state stored. Coach re-frames by re-uploading.
//
// PROPS
//   file       — File from the <input type="file"> change event.
//   orgColor   — for the primary button + slider accent.
//   onCancel() — close without uploading.
//   onConfirm(framedBlob) — fires when the coach taps "Use this image".
//                Blob is JPEG, ~88 % quality, dimensions matching the
//                framed pixel rect at native resolution.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from 'react'
import Cropper from 'react-easy-crop'

const OUTPUT_MIME = 'image/jpeg'
const OUTPUT_QUALITY = 0.88
// Viewport-aspect clamps. A very wide panorama (e.g. 8:1) or very tall
// photo (1:8) would make the dialog viewport unusable on a phone screen.
// We clamp the *viewport* (the dialog's framing area), not the cropper's
// aspect — the image still renders contain-fit inside that viewport with
// dead space, and the coach's crop output is still at the image's true
// aspect. The clamps are only here so the dialog itself doesn't become a
// hairline strip.
const MIN_VIEWPORT_ASPECT = 0.5    // 1:2 (very tall)
const MAX_VIEWPORT_ASPECT = 2.5    // 5:2 (very wide)
const FALLBACK_ASPECT     = 16 / 9 // shown while the image is still decoding

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
// neither up- nor down-sample. At zoom 1 with no pan, pixelCrop covers
// the whole image and the output is effectively a re-encoded copy of
// the source.
async function cropToBlob(dataUrl, pixelCrop) {
  const img = await loadImage(dataUrl)
  const canvas = document.createElement('canvas')
  canvas.width  = Math.max(1, Math.round(pixelCrop.width))
  canvas.height = Math.max(1, Math.round(pixelCrop.height))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas not supported in this browser')
  // White underfill — flattens any source alpha to white, which matches
  // what the whiteboard's Blank surface and eraser-punch-through both
  // show. Harmless for opaque JPEGs.
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(
    img,
    pixelCrop.x, pixelCrop.y, pixelCrop.width, pixelCrop.height,
    0, 0,                    canvas.width,     canvas.height,
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
  orgColor = '#cc1111',
  onCancel,
  onConfirm,
}) {
  const [dataUrl,     setDataUrl]     = useState(null)
  const [imageAspect, setImageAspect] = useState(null)
  const [readErr,     setReadErr]     = useState('')
  const [crop,        setCrop]        = useState({ x: 0, y: 0 })
  const [zoom,        setZoom]        = useState(1)
  const [pixelCrop,   setPixelCrop]   = useState(null)
  const [working,     setWorking]     = useState(false)
  const [err,         setErr]         = useState('')

  // Load the file, then probe the image's natural dimensions so we can
  // configure the cropper to the image's own aspect ratio. That's how we
  // guarantee zoom=1 = whole image — the crop box and the image share
  // an aspect, so the box exactly covers the image at minimum zoom.
  useEffect(() => {
    if (!file) return
    let cancelled = false
    fileToDataUrl(file)
      .then(async url => {
        if (cancelled) return
        setDataUrl(url)
        const img = await loadImage(url)
        if (cancelled) return
        const ar = img.naturalWidth / img.naturalHeight
        setImageAspect(Number.isFinite(ar) && ar > 0 ? ar : 1)
      })
      .catch(e => { if (!cancelled) setReadErr(e?.message ?? 'Could not read image') })
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

  // Cropper aspect: image's natural aspect once known, else 1:1 placeholder
  // while loading. Using the image's own aspect is what gives us "whole
  // image visible by default" — crop box and image share an aspect, so
  // the box exactly covers the image at zoom 1.
  const cropAspect = imageAspect ?? 1

  // Viewport aspect (the visible cropper frame inside the dialog): match
  // the image so the contain-fit doesn't leave huge dead space around the
  // image. Clamped for extremes (panoramas, tall portraits) so the
  // dialog itself stays usable on small screens.
  const viewportAspect = imageAspect
    ? Math.min(MAX_VIEWPORT_ASPECT, Math.max(MIN_VIEWPORT_ASPECT, imageAspect))
    : FALLBACK_ASPECT

  const isZoomedIn = zoom > 1.001

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
            The whole image is shown by default. Tap{' '}
            <span style={{ color: '#e8d8d8' }}>Use this image</span>{' '}
            to keep it as-is, or zoom and drag to focus on a section.
            The board will letterbox if it&apos;s wider or taller than
            your image — content won&apos;t be chopped.
          </p>
        </div>

        {/* Cropper viewport — matched to the image's aspect so at zoom=1
            the image fills the frame with no dead space. */}
        <div
          className="relative w-full rounded-xl overflow-hidden"
          style={{
            aspectRatio:     String(viewportAspect),
            backgroundColor: '#0a0000',
            border:          '1px solid #2a0000',
          }}
        >
          {readErr && (
            <div className="absolute inset-0 flex items-center justify-center p-6 text-center">
              <p className="text-sm" style={{ color: '#ff6666' }}>{readErr}</p>
            </div>
          )}
          {!readErr && dataUrl && imageAspect && (
            <Cropper
              image={dataUrl}
              crop={crop}
              zoom={zoom}
              aspect={cropAspect}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={onCropComplete}
              minZoom={1}
              maxZoom={4}
              objectFit="contain"
              showGrid={isZoomedIn}
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
            disabled={!dataUrl || !imageAspect || !!readErr || working}
            className="flex-1"
            style={{ accentColor: orgColor }}
          />
          <span className="text-xs font-mono tabular-nums" style={{ color: '#9a8080', minWidth: '4ch', textAlign: 'right' }}>
            {zoom.toFixed(2)}×
          </span>
          {isZoomedIn && (
            <button
              type="button"
              onClick={() => { setZoom(1); setCrop({ x: 0, y: 0 }) }}
              disabled={working}
              className="text-xs px-2 py-1 rounded-lg disabled:opacity-50"
              style={{ border: '1px solid #2a0000', color: '#9a8080' }}
              title="Show the whole image"
            >
              Fit
            </button>
          )}
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
            disabled={working || !dataUrl || !pixelCrop || !!readErr || !imageAspect}
            className="flex-1 py-3 rounded-lg text-sm font-bold text-white disabled:opacity-40"
            style={{ backgroundColor: orgColor }}
          >
            {working
              ? 'Saving…'
              : isZoomedIn
                ? 'Use this crop'
                : 'Use this image'}
          </button>
        </div>
      </div>
    </div>
  )
}
