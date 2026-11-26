declare module 'unzipper' {
  export interface ZipEntry {
    path: string
    type: string
    flags: number
    compressionMethod: number
    crc32: number
    compressedSize: number
    uncompressedSize: number
    externalFileAttributes: number
    versionMadeBy: number
    fileNameLength: number
    extraFieldLength: number
    offsetToLocalFileHeader: number
    pathBuffer: Buffer
    diskNumber?: number
    stream(): NodeJS.ReadableStream
  }

  export interface ZipDirectory {
    files: ZipEntry[]
  }

  export const Open: {
    file(path: string): Promise<ZipDirectory>
  }
}
