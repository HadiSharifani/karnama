import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const outputDirectory = join(dirname(fileURLToPath(import.meta.url)), '..', 'resources')
await mkdir(outputDirectory, { recursive: true })

const sizes = [16, 32, 48, 256]
const images = sizes.map(renderDibIcon)
const headerSize = 6 + sizes.length * 16
let nextOffset = headerSize
const directory = Buffer.alloc(headerSize)
directory.writeUInt16LE(1, 2)
directory.writeUInt16LE(sizes.length, 4)
for (let index = 0; index < sizes.length; index++) {
  const size = sizes[index]
  const entry = 6 + index * 16
  directory[entry] = size === 256 ? 0 : size
  directory[entry + 1] = size === 256 ? 0 : size
  directory.writeUInt16LE(1, entry + 4)
  directory.writeUInt16LE(32, entry + 6)
  directory.writeUInt32LE(images[index].length, entry + 8)
  directory.writeUInt32LE(nextOffset, entry + 12)
  nextOffset += images[index].length
}

await writeFile(join(outputDirectory, 'app.ico'), Buffer.concat([directory, ...images]))

function renderDibIcon(size) {
  const xorBytes = size * size * 4
  const maskRowBytes = Math.ceil(size / 32) * 4
  const maskBytes = maskRowBytes * size
  const image = Buffer.alloc(40 + xorBytes + maskBytes)
  image.writeUInt32LE(40, 0)
  image.writeInt32LE(size, 4)
  image.writeInt32LE(size * 2, 8)
  image.writeUInt16LE(1, 12)
  image.writeUInt16LE(32, 14)
  image.writeUInt32LE(0, 16)
  image.writeUInt32LE(xorBytes + maskBytes, 20)

  const samples = 4
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let red = 0
      let green = 0
      let blue = 0
      let alpha = 0
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const px = ((x + (sx + 0.5) / samples) / size) * 256
          const py = ((y + (sy + 0.5) / samples) / size) * 256
          const color = colorAt(px, py)
          if (!color) continue
          red += color[0]
          green += color[1]
          blue += color[2]
          alpha += 255
        }
      }
      const pixelCount = samples * samples
      const pixel = 40 + ((size - 1 - y) * size + x) * 4
      image[pixel] = Math.round(blue / pixelCount)
      image[pixel + 1] = Math.round(green / pixelCount)
      image[pixel + 2] = Math.round(red / pixelCount)
      image[pixel + 3] = Math.round(alpha / pixelCount)
    }
  }
  return image
}

function colorAt(x, y) {
  if (!insideRoundedRect(x, y, 14, 14, 228, 228, 48)) return null
  if (distanceToSegment(x, y, 101, 78, 101, 178) <= 10) return [255, 255, 255]
  if (distanceToSegment(x, y, 106, 127, 166, 78) <= 10) return [255, 255, 255]
  if (distanceToSegment(x, y, 106, 129, 167, 178) <= 10) return [255, 255, 255]
  if ((x - 128) ** 2 + (y - 128) ** 2 <= 77 ** 2) return [79, 70, 229]
  return [17, 24, 39]
}

function insideRoundedRect(x, y, left, top, width, height, radius) {
  const cx = Math.max(left + radius, Math.min(x, left + width - radius))
  const cy = Math.max(top + radius, Math.min(y, top + height - radius))
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2
}

function distanceToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1
  const dy = y2 - y1
  const lengthSquared = dx * dx + dy * dy
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lengthSquared))
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))
}
