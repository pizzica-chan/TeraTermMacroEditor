import { bytesFingerprint, createFileExternalWatcher, POLL_INTERVAL_MS } from '../src/ui/fileExternalWatch'
import type { EditorTab } from '../src/ui/tabManager'
import { DocumentSettings } from '../src/text/documentSettings'

let passed = 0
let failed = 0

function ok(name: string, cond: boolean): void {
  if (cond) {
    passed++
    console.log(`  OK  ${name}`)
  } else {
    failed++
    console.log(`  NG  ${name}`)
  }
}

function baselineKey(tab: EditorTab): string {
  const { bytes } = tab.docSettings.prepareSave(tab.savedContent)
  return bytesFingerprint(bytes)
}

function makeTab(
  id: string,
  fileName: string,
  content: string,
  handle: FileSystemFileHandle,
): EditorTab {
  const docSettings = new DocumentSettings()
  docSettings.loadFromText(content)
  return {
    id,
    fileName,
    docSettings,
    fileHandle: handle,
    editorState: null as never,
    savedContent: content,
    includeBindings: {},
  }
}

class MockFileHandle implements FileSystemFileHandle {
  readonly kind = 'file' as const
  constructor(
    readonly name: string,
    private file: File,
  ) {}

  getFile(): Promise<File> {
    return Promise.resolve(this.file)
  }

  createWritable(): Promise<FileSystemWritableFileStream> {
    throw new Error('not implemented in test')
  }

  update(file: File): void {
    this.file = file
  }
}

async function readFileAsBytes(file: File): Promise<Uint8Array> {
  const buffer = await file.arrayBuffer()
  return new Uint8Array(buffer)
}

function makeFile(name: string, content: string, lastModified = Date.now()): File {
  return new File([content], name, { type: 'text/plain', lastModified })
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

function createHarness(options?: {
  isTabDirty?: (tab: EditorTab) => boolean
}) {
  const tabs: EditorTab[] = []
  let activeTabId: string | null = null
  const pending = new Set<string>()
  let banner: { tabId: string; fileName: string; dirty: boolean } | null = null
  const reloads: string[] = []

  const watcher = createFileExternalWatcher(
    {
      getTabs: () => tabs,
      getActiveTabId: () => activeTabId,
      isTabDirty: options?.isTabDirty ?? (() => false),
      getTabBaselineKey: baselineKey,
      readFileAsBytes,
      onReloadTab(t, bytes) {
        const text = new TextDecoder().decode(bytes)
        t.savedContent = text
        reloads.push(text)
      },
      onPendingChange(tabId, isPending) {
        if (isPending) pending.add(tabId)
        else pending.delete(tabId)
      },
      onBannerUpdate(info) {
        banner = info
      },
    },
    { debug: false },
  )

  return { tabs, activeTabId: (id: string | null) => (activeTabId = id), pending, banner: () => banner, reloads, watcher }
}

async function main(): Promise<void> {
  console.log('=== fileExternalWatch ===')
  ok('poll interval is 1s', POLL_INTERVAL_MS === 1000)

  const a = new TextEncoder().encode('hello')
  const b = new TextEncoder().encode('hello!')
  ok('fingerprint stable', bytesFingerprint(a) === bytesFingerprint(a))
  ok('fingerprint differs', bytesFingerprint(a) !== bytesFingerprint(b))

  // --- basic detect / dismiss / re-detect / reload ---
  {
    const h = createHarness()
    const initial = makeFile('test.ttl', "line1\n", 1_000)
    const handle = new MockFileHandle('test.ttl', initial)
    const tab = makeTab('tab-1', 'test.ttl', "line1\n", handle)
    h.tabs.push(tab)
    h.activeTabId(tab.id)

    h.watcher.markDiskSynced(tab.id, await readFileAsBytes(initial), initial)
    ok('initial pending cleared', !h.pending.has(tab.id))

    handle.update(makeFile('test.ttl', "line1\nline2\n", 2_000))
    await wait(POLL_INTERVAL_MS + 200)
    ok('external change detected', h.pending.has(tab.id))
    ok('banner shown', h.banner()?.tabId === tab.id)

    h.watcher.dismissBanner(tab.id)
    ok('banner hidden after dismiss', h.banner() === null)
    ok('pending remains after dismiss', h.pending.has(tab.id))

    handle.update(makeFile('test.ttl', "line1\nline2\nline3\n", 3_000))
    await wait(POLL_INTERVAL_MS + 200)
    ok('second change re-shows banner', h.banner()?.tabId === tab.id)

    ok('reload succeeds', await h.watcher.reloadTab(tab.id))
    ok('reload updates content', tab.savedContent === "line1\nline2\nline3\n")
    ok('pending cleared after reload', !h.pending.has(tab.id))
    h.watcher.stop()
  }

  // --- saving suppresses detection ---
  {
    const h = createHarness()
    const initial = makeFile('save.ttl', 'a\n', 1_000)
    const handle = new MockFileHandle('save.ttl', initial)
    const tab = makeTab('tab-save', 'save.ttl', 'a\n', handle)
    h.tabs.push(tab)
    h.activeTabId(tab.id)
    h.watcher.markDiskSynced(tab.id, await readFileAsBytes(initial), initial)

    h.watcher.setSaving(tab.id, true)
    handle.update(makeFile('save.ttl', 'b\n', 2_000))
    await h.watcher.pollNow()
    ok('saving suppresses external detect', !h.pending.has(tab.id))

    h.watcher.setSaving(tab.id, false)
    await h.watcher.pollNow()
    ok('detect resumes after saving', h.pending.has(tab.id))
    h.watcher.stop()
  }

  // --- bootstrap detects disk/editor mismatch ---
  {
    const h = createHarness()
    const disk = makeFile('boot.ttl', "disk\n", 5_000)
    const handle = new MockFileHandle('boot.ttl', disk)
    const tab = makeTab('tab-boot', 'boot.ttl', "editor\n", handle)
    h.tabs.push(tab)
    h.activeTabId(tab.id)

    await h.watcher.pollNow()
    ok('bootstrap flags mismatch', h.pending.has(tab.id))
    ok('bootstrap banner shown', h.banner()?.tabId === tab.id)
    h.watcher.stop()
  }

  // --- mtime-only touch does not alert ---
  {
    const h = createHarness()
    const content = "same\n"
    const initial = makeFile('touch.ttl', content, 1_000)
    const handle = new MockFileHandle('touch.ttl', initial)
    const tab = makeTab('tab-touch', 'touch.ttl', content, handle)
    h.tabs.push(tab)
    h.activeTabId(tab.id)
    h.watcher.markDiskSynced(tab.id, await readFileAsBytes(initial), initial)

    handle.update(makeFile('touch.ttl', content, 9_000))
    await h.watcher.pollNow()
    ok('mtime-only touch ignored', !h.pending.has(tab.id))
    h.watcher.stop()
  }

  // --- inactive tab pending, banner on switch ---
  {
    const h = createHarness()
    const initial = makeFile('a.ttl', 'a\n', 1_000)
    const handleA = new MockFileHandle('a.ttl', initial)
    const tabA = makeTab('tab-a', 'a.ttl', 'a\n', handleA)
    const tabB = makeTab('tab-b', 'b.ttl', 'b\n', new MockFileHandle('b.ttl', makeFile('b.ttl', 'b\n')))
    tabB.fileHandle = null
    h.tabs.push(tabA, tabB)
    h.activeTabId(tabB.id)

    h.watcher.markDiskSynced(tabA.id, await readFileAsBytes(initial), initial)
    handleA.update(makeFile('a.ttl', "a\nchanged\n", 2_000))
    await h.watcher.pollNow()
    ok('inactive tab pending', h.pending.has(tabA.id))
    ok('inactive tab hides banner', h.banner() === null)

    h.activeTabId(tabA.id)
    h.watcher.refreshBanner()
    ok('banner on tab switch', h.banner()?.tabId === tabA.id)
    h.watcher.stop()
  }

  // --- dirty banner text updates ---
  {
    const h = createHarness({ isTabDirty: () => true })
    const initial = makeFile('dirty.ttl', 'x\n', 1_000)
    const handle = new MockFileHandle('dirty.ttl', initial)
    const tab = makeTab('tab-dirty', 'dirty.ttl', 'x\n', handle)
    h.tabs.push(tab)
    h.activeTabId(tab.id)
    h.watcher.markDiskSynced(tab.id, await readFileAsBytes(initial), initial)
    handle.update(makeFile('dirty.ttl', "y\n", 2_000))
    await h.watcher.pollNow()
    ok('dirty banner flag', h.banner()?.dirty === true)
    h.watcher.stop()
  }

  // --- markDiskSynced clears pending ---
  {
    const h = createHarness()
    const initial = makeFile('sync.ttl', 'z\n', 1_000)
    const handle = new MockFileHandle('sync.ttl', initial)
    const tab = makeTab('tab-sync', 'sync.ttl', 'z\n', handle)
    h.tabs.push(tab)
    h.activeTabId(tab.id)
    h.watcher.markDiskSynced(tab.id, await readFileAsBytes(initial), initial)
    handle.update(makeFile('sync.ttl', "z2\n", 2_000))
    await h.watcher.pollNow()
    ok('pending before resync', h.pending.has(tab.id))
    const file = await handle.getFile()
    h.watcher.markDiskSynced(tab.id, await readFileAsBytes(file), file)
    ok('pending cleared on resync', !h.pending.has(tab.id))
    h.watcher.stop()
  }

  // --- clearTab ---
  {
    const h = createHarness()
    const initial = makeFile('clear.ttl', 'c\n', 1_000)
    const handle = new MockFileHandle('clear.ttl', initial)
    const tab = makeTab('tab-clear', 'clear.ttl', 'c\n', handle)
    h.tabs.push(tab)
    h.activeTabId(tab.id)
    h.watcher.markDiskSynced(tab.id, await readFileAsBytes(initial), initial)
    handle.update(makeFile('clear.ttl', "c2\n", 2_000))
    await h.watcher.pollNow()
    h.watcher.clearTab(tab.id)
    ok('clearTab removes pending', !h.pending.has(tab.id))
    h.watcher.stop()
  }

  // --- aborted save placeholder cleanup ---
  {
    const h = createHarness()
    const tab = makeTab('tab-fail', 'fail.ttl', 'x\n', new MockFileHandle('fail.ttl', makeFile('fail.ttl', 'x\n')))
    h.tabs.push(tab)
    h.activeTabId(tab.id)
    h.watcher.setSaving(tab.id, true)
    h.watcher.setSaving(tab.id, false)
    await h.watcher.pollNow()
    ok('aborted save no false positive', !h.pending.has(tab.id))
    h.watcher.stop()
  }

  // --- post-save mtime drift (bytes-only sync) ---
  {
    const h = createHarness()
    const content = 'saved\n'
    const initial = makeFile('post.ttl', content, 1_000)
    const handle = new MockFileHandle('post.ttl', initial)
    const tab = makeTab('tab-post', 'post.ttl', content, handle)
    h.tabs.push(tab)
    h.activeTabId(tab.id)
    const bytes = await readFileAsBytes(initial)
    h.watcher.markDiskSynced(tab.id, bytes)
    handle.update(makeFile('post.ttl', content, 99_000))
    await h.watcher.pollNow()
    ok('post-save mtime drift ignored', !h.pending.has(tab.id))
    h.watcher.stop()
  }

  // --- hasPending tracks state ---
  {
    const h = createHarness()
    const initial = makeFile('hp.ttl', 'h\n', 1_000)
    const handle = new MockFileHandle('hp.ttl', initial)
    const tab = makeTab('tab-hp', 'hp.ttl', 'h\n', handle)
    h.tabs.push(tab)
    h.activeTabId(tab.id)
    h.watcher.markDiskSynced(tab.id, await readFileAsBytes(initial), initial)
    ok('hasPending false initially', !h.watcher.hasPending(tab.id))
    handle.update(makeFile('hp.ttl', "h2\n", 2_000))
    await h.watcher.pollNow()
    ok('hasPending true after change', h.watcher.hasPending(tab.id))
    h.watcher.stop()
  }

  // --- same content after dismiss does not re-alert; new content does ---
  {
    const h = createHarness()
    const initial = makeFile('d2.ttl', 'd\n', 1_000)
    const handle = new MockFileHandle('d2.ttl', initial)
    const tab = makeTab('tab-d2', 'd2.ttl', 'd\n', handle)
    h.tabs.push(tab)
    h.activeTabId(tab.id)
    h.watcher.markDiskSynced(tab.id, await readFileAsBytes(initial), initial)
    handle.update(makeFile('d2.ttl', "d2\n", 2_000))
    await h.watcher.pollNow()
    h.watcher.dismissBanner(tab.id)
    ok('dismiss hides same version', h.banner() === null)
    await h.watcher.pollNow()
    ok('poll same version stays dismissed', h.banner() === null)
    handle.update(makeFile('d2.ttl', "d3\n", 3_000))
    await h.watcher.pollNow()
    ok('new version re-shows banner', h.banner()?.tabId === tab.id)
    h.watcher.stop()
  }

  console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===`)
  if (failed > 0) process.exit(1)
}

void main()
