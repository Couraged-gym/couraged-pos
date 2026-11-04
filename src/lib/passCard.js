// A member's QR as a branded portrait image (1080×1440 PNG): for their photos, or to print.
// `qr` is a rendered <QRCodeCanvas> (already has the logo in the middle).
const W = 1080, H = 1440
const DISPLAY = '"Big Shoulders Display Variable", "Arial Narrow", sans-serif'
const SANS = 'Barlow, system-ui, sans-serif'

const loadImage = (src) =>
  new Promise((ok, fail) => {
    const img = new Image()
    img.onload = () => ok(img)
    img.onerror = fail
    img.src = src
  })

// Largest font size (down to `min`) at which `text` fits in `width`.
function fit(ctx, text, weight, family, max, min, width) {
  let size = max
  for (; size > min; size -= 2) {
    ctx.font = `${weight} ${size}px ${family}`
    if (ctx.measureText(text).width <= width) break
  }
  return size
}

export async function passCardBlob(qr, { name, code }) {
  await Promise.all([document.fonts.load(`900 80px ${DISPLAY}`), document.fonts.load(`600 40px ${SANS}`)]).catch(() => {})
  const logo = await loadImage('/assets/logo.jpg').catch(() => null)

  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const ctx = c.getContext('2d')
  ctx.fillStyle = '#19171B'
  ctx.fillRect(0, 0, W, H)

  // Header: logo + wordmark.
  if (logo) ctx.drawImage(logo, 80, 70, 96, 96)
  ctx.textBaseline = 'middle'
  ctx.font = `800 52px ${DISPLAY}`
  ctx.fillStyle = '#FFFFFF'
  ctx.fillText('COURAGED', logo ? 196 : 80, 120)
  const w = ctx.measureText('COURAGED ').width
  ctx.fillStyle = '#FEBE10'
  ctx.fillText('FITNESS HUB', (logo ? 196 : 80) + w, 120)

  // White card with the code.
  const x = 80, y = 220, cw = W - 160, ch = 1060
  ctx.fillStyle = '#FFFFFF'
  ctx.beginPath()
  ctx.roundRect(x, y, cw, ch, 40)
  ctx.fill()
  const q = 760
  ctx.imageSmoothingEnabled = false // keep the modules crisp
  ctx.drawImage(qr, (W - q) / 2, y + 50, q, q)

  ctx.fillStyle = '#19171B'
  ctx.textAlign = 'center'
  const upper = name.toUpperCase()
  fit(ctx, upper, 900, DISPLAY, 96, 48, cw - 80)
  ctx.fillText(upper, W / 2, y + 50 + q + 85)
  ctx.font = `600 44px ${SANS}`
  ctx.fillStyle = '#5E5A63'
  ctx.fillText(code, W / 2, y + 50 + q + 160)

  ctx.font = `500 34px ${SANS}`
  ctx.fillStyle = '#B4AFB9'
  ctx.fillText('Scan at the front desk to check in · couragedph.com', W / 2, H - 80)

  return new Promise((ok) => c.toBlob(ok, 'image/png'))
}

// Phones: the share sheet (iPhone's "Save Image" puts it in Photos). Elsewhere: a download.
export async function saveImage(blob, filename) {
  const file = new File([blob], filename, { type: 'image/png' })
  if (navigator.canShare?.({ files: [file] }) && matchMedia('(pointer: coarse)').matches) {
    try {
      await navigator.share({ files: [file], title: filename })
      return
    } catch (e) {
      if (e.name === 'AbortError') return // they closed the sheet
    }
  }
  const url = URL.createObjectURL(blob)
  const a = Object.assign(document.createElement('a'), { href: url, download: filename })
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
