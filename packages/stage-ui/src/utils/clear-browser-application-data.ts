interface FileSystemDirectoryHandleLike {
  entries: () => AsyncIterableIterator<[string, unknown]>
  removeEntry: (name: string, options: { recursive: boolean }) => Promise<void>
}

function deleteIndexedDatabase(name: string) {
  return new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error ?? new Error(`Failed to delete IndexedDB database: ${name}`))
    request.onblocked = () => reject(new Error(`IndexedDB database is still open: ${name}`))
  })
}

async function clearIndexedDatabases() {
  if (!indexedDB.databases)
    throw new Error('This browser cannot enumerate IndexedDB databases for complete deletion.')

  const databases = await indexedDB.databases()
  await Promise.all(databases
    .map(database => database.name)
    .filter((name): name is string => Boolean(name))
    .map(deleteIndexedDatabase))
}

async function clearCacheStorage() {
  if (typeof caches === 'undefined')
    return

  const cacheNames = await caches.keys()
  await Promise.all(cacheNames.map(cacheName => caches.delete(cacheName)))
}

async function clearOriginPrivateFileSystem() {
  if (!navigator.storage?.getDirectory)
    return

  const root = await navigator.storage.getDirectory() as unknown as FileSystemDirectoryHandleLike
  for await (const [name] of root.entries())
    await root.removeEntry(name, { recursive: true })
}

export async function clearBrowserApplicationData(options: { includeIndexedDB: boolean }) {
  await Promise.all([
    clearCacheStorage(),
    clearOriginPrivateFileSystem(),
    options.includeIndexedDB ? clearIndexedDatabases() : Promise.resolve(),
  ])

  localStorage.clear()
  sessionStorage.clear()
}
