export function useDownload(data: Blob, filename: string) {
  function download() {
    const url = URL.createObjectURL(data)

    const downloadLink = document.createElement('a')
    downloadLink.href = url
    downloadLink.download = filename
    downloadLink.style.display = 'none'
    document.body.appendChild(downloadLink)
    downloadLink.click()
    downloadLink.remove()

    // Clean up the URL object after the download
    setTimeout(() => {
      URL.revokeObjectURL(url)
    }, 5000)
  }

  return {
    download,
  }
}

export async function saveBlobDocument(data: Blob, filename: string) {
  const bridge = (window as Window & { pocketBridge?: {
    beginDocumentExport: (input: { name: string, mimeType: string }) => Promise<void>
    appendDocumentExport: (input: { chunk: string }) => Promise<void>
    finishDocumentExport: () => Promise<void>
  } }).pocketBridge
  if (!bridge) {
    useDownload(data, filename).download()
    return
  }

  await bridge.beginDocumentExport({ name: filename, mimeType: data.type || 'application/octet-stream' })
  for (let offset = 0; offset < data.size; offset += 192 * 1024) {
    const bytes = new Uint8Array(await data.slice(offset, offset + 192 * 1024).arrayBuffer())
    let binary = ''
    for (let index = 0; index < bytes.length; index += 8192)
      binary += String.fromCharCode(...bytes.subarray(index, index + 8192))
    await bridge.appendDocumentExport({ chunk: btoa(binary) })
  }
  await bridge.finishDocumentExport()
}
