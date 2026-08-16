import zlib from 'node:zlib'

function decodePng(buffer: Buffer): { width: number; height: number; pixels: Buffer; bytesPerPixel: number } {
  let offset = 8
  let width = 0
  let height = 0
  let bytesPerPixel = 4
  const chunks: Buffer[] = []
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    const data = buffer.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bytesPerPixel = data[9] === 6 ? 4 : 3
    } else if (type === 'IDAT') {
      chunks.push(data)
    } else if (type === 'IEND') {
      break
    }
    offset += length + 12
  }

  const raw = zlib.inflateSync(Buffer.concat(chunks))
  const stride = width * bytesPerPixel
  const pixels = Buffer.alloc(height * stride)
  let source = 0
  for (let y = 0; y < height; y++) {
    const filter = raw[source++]!
    for (let x = 0; x < stride; x++) {
      const value = raw[source++]!
      const left = x >= bytesPerPixel ? pixels[y * stride + x - bytesPerPixel]! : 0
      const above = y > 0 ? pixels[(y - 1) * stride + x]! : 0
      const upperLeft = y > 0 && x >= bytesPerPixel ? pixels[(y - 1) * stride + x - bytesPerPixel]! : 0
      let result = value
      if (filter === 1) result = (value + left) & 255
      else if (filter === 2) result = (value + above) & 255
      else if (filter === 3) result = (value + Math.floor((left + above) / 2)) & 255
      else if (filter === 4) {
        const p = left + above - upperLeft
        const pa = Math.abs(p - left)
        const pb = Math.abs(p - above)
        const pc = Math.abs(p - upperLeft)
        result = (value + (pa <= pb && pa <= pc ? left : pb <= pc ? above : upperLeft)) & 255
      }
      pixels[y * stride + x] = result
    }
  }
  return { width, height, pixels, bytesPerPixel }
}

export function measurePaintedFractionGaps(buffer: Buffer): { top: number; bottom: number } {
  const { width, height, pixels, bytesPerPixel } = decodePng(buffer)
  const dark = (x: number, y: number) => {
    const index = (y * width + x) * bytesPerPixel
    return pixels[index]! < 160 && pixels[index + 1]! < 160 && pixels[index + 2]! < 160
  }

  let lineY = -1
  let lineStart = -1
  let lineEnd = -1
  let longest = 0
  for (let y = 0; y < height; y++) {
    let start = -1
    for (let x = 0; x <= width; x++) {
      if (x < width && dark(x, y)) {
        if (start < 0) start = x
      } else if (start >= 0) {
        if (x - start > longest) {
          longest = x - start
          lineY = y
          lineStart = start
          lineEnd = x - 1
        }
        start = -1
      }
    }
  }

  const darkCount = (y: number) => {
    let count = 0
    for (let x = lineStart; x <= lineEnd; x++) {
      if (dark(x, y)) count++
    }
    return count
  }
  let lineTop = lineY
  let lineBottom = lineY
  while (lineTop > 0 && darkCount(lineTop - 1) > longest * 0.8) lineTop--
  while (lineBottom + 1 < height && darkCount(lineBottom + 1) > longest * 0.8) lineBottom++

  let above = lineTop - 1
  while (above >= 0 && darkCount(above) === 0) above--
  let below = lineBottom + 1
  while (below < height && darkCount(below) === 0) below++
  return { top: lineTop - above - 1, bottom: below - lineBottom - 1 }
}
