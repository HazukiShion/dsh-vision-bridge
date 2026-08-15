/**
 * Crop a PNG without leaving Node.
 *
 * `region` exists because the first stress test showed what a whole-image
 * question actually costs: the agent could not get precise layout facts out of
 * one description, and fell back to driving Pillow through Bash — dozens of
 * steps and a million tokens of shell output. Cropping first is the cheap
 * version of that: it focuses the model's attention AND cuts the bytes.
 *
 * Zero dependencies, so the plugin keeps its no-build-chain property. Only the
 * shape browsers actually emit is supported — 8-bit, non-interlaced, colour
 * type 2 (RGB) or 6 (RGBA) — and anything else fails loudly instead of
 * silently returning the wrong pixels.
 *
 * @module @shion/dsh-vision-bridge/png-crop
 */

import { crc32, deflateSync, inflateSync } from 'node:zlib'

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/** Bytes per pixel for the colour types this decoder accepts. */
const CHANNELS = { 2: 3, 6: 4 }

/** Paeth predictor, exactly as the PNG spec defines it. */
function paeth(a, b, c) {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  return pb <= pc ? b : c
}

/** Split a PNG into its header facts and concatenated image data. */
function readChunks(bytes) {
  for (let i = 0; i < SIGNATURE.length; i++) {
    if (bytes[i] !== SIGNATURE[i]) throw new Error('not a PNG image')
  }

  let offset = 8
  let header
  const idat = []

  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(offset)
    const type = bytes.toString('ascii', offset + 4, offset + 8)
    const start = offset + 8
    const data = bytes.subarray(start, start + length)

    if (type === 'IHDR') {
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        interlace: data[12],
      }
    } else if (type === 'IDAT') {
      idat.push(data)
    } else if (type === 'IEND') {
      break
    }

    offset = start + length + 4
  }

  if (!header) throw new Error('PNG has no IHDR chunk')
  return { header, data: Buffer.concat(idat) }
}

/** Undo per-scanline filtering, returning raw pixel rows. */
function unfilter(raw, width, height, bpp) {
  const stride = width * bpp
  const out = Buffer.alloc(height * stride)

  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride)
    const target = y * stride
    const above = target - stride

    for (let x = 0; x < stride; x++) {
      const left = x >= bpp ? out[target + x - bpp] : 0
      const up = y > 0 ? out[above + x] : 0
      const upLeft = y > 0 && x >= bpp ? out[above + x - bpp] : 0
      const value = line[x]

      switch (filter) {
        case 0: out[target + x] = value; break
        case 1: out[target + x] = (value + left) & 0xff; break
        case 2: out[target + x] = (value + up) & 0xff; break
        case 3: out[target + x] = (value + ((left + up) >> 1)) & 0xff; break
        case 4: out[target + x] = (value + paeth(left, up, upLeft)) & 0xff; break
        default: throw new Error(`unsupported PNG scanline filter ${filter}`)
      }
    }
  }
  return out
}

/** One length-type-data-crc chunk. */
function chunk(type, data) {
  const head = Buffer.alloc(4)
  head.writeUInt32BE(data.length, 0)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const tail = Buffer.alloc(4)
  tail.writeUInt32BE(crc32(body) >>> 0, 0)
  return Buffer.concat([head, body, tail])
}

/**
 * Parse `x1,y1,x2,y2` into a rectangle clamped to the image.
 * @param spec - the caller's region string.
 * @param width - image width.
 * @param height - image height.
 * @returns the clamped rectangle.
 */
export function parseRegion(spec, width, height) {
  const parts = String(spec).split(',').map((value) => Number(value.trim()))
  if (parts.length !== 4 || parts.some((value) => !Number.isFinite(value))) {
    throw new Error(`region must be "x1,y1,x2,y2" in pixels; got ${JSON.stringify(spec)}`)
  }

  const x1 = Math.max(0, Math.min(width, Math.round(Math.min(parts[0], parts[2]))))
  const y1 = Math.max(0, Math.min(height, Math.round(Math.min(parts[1], parts[3]))))
  const x2 = Math.max(0, Math.min(width, Math.round(Math.max(parts[0], parts[2]))))
  const y2 = Math.max(0, Math.min(height, Math.round(Math.max(parts[1], parts[3]))))

  if (x2 - x1 < 1 || y2 - y1 < 1) {
    throw new Error(`region ${JSON.stringify(spec)} is empty inside a ${width}x${height} image`)
  }
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 }
}

/**
 * Crop a PNG to one rectangle.
 * @param bytes - the source PNG.
 * @param spec - region string, `x1,y1,x2,y2`.
 * @returns cropped PNG bytes plus the rectangle actually used.
 */
export function cropPng(bytes, spec) {
  const source = Buffer.from(bytes)
  const { header, data } = readChunks(source)

  if (header.bitDepth !== 8 || header.interlace !== 0 || !CHANNELS[header.colorType]) {
    throw new Error(
      `region needs an 8-bit non-interlaced RGB/RGBA PNG; this one is `
      + `bitDepth ${header.bitDepth}, colourType ${header.colorType}, interlace ${header.interlace}. `
      + 'Omit region to send the whole image.',
    )
  }

  const bpp = CHANNELS[header.colorType]
  const rect = parseRegion(spec, header.width, header.height)
  const pixels = unfilter(inflateSync(data), header.width, header.height, bpp)

  // Re-emit with filter 0 on every row: the crop is small by definition, so
  // spending bytes to keep the encoder trivial is the right trade.
  const stride = rect.width * bpp
  const raw = Buffer.alloc(rect.height * (stride + 1))
  for (let y = 0; y < rect.height; y++) {
    const from = ((rect.y + y) * header.width + rect.x) * bpp
    raw[y * (stride + 1)] = 0
    pixels.copy(raw, y * (stride + 1) + 1, from, from + stride)
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(rect.width, 0)
  ihdr.writeUInt32BE(rect.height, 4)
  ihdr[8] = 8
  ihdr[9] = header.colorType

  return {
    bytes: Buffer.concat([
      Buffer.from(SIGNATURE),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(raw, { level: 9 })),
      chunk('IEND', Buffer.alloc(0)),
    ]),
    rect,
    source: { width: header.width, height: header.height },
  }
}
