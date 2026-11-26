import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  check: vi.fn(),
  relaunch: vi.fn(),
  isInstalledMode: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-updater', () => ({ check: mocks.check }))
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: mocks.relaunch }))
vi.mock('../utils/portable', () => ({ isInstalledMode: mocks.isInstalledMode }))

const PENDING_UPDATE_KEY = 'markeron:pending-update-version'

type FakeUpdate = {
  version: string
  download: ReturnType<typeof vi.fn>
  install: ReturnType<typeof vi.fn>
}

function makeUpdate(overrides: Partial<FakeUpdate> = {}): FakeUpdate {
  return {
    version: '2.99.0',
    download: vi.fn(async (onEvent?: (event: unknown) => void) => {
      onEvent?.({ event: 'Started', data: { contentLength: 100 } })
      onEvent?.({ event: 'Progress', data: { chunkLength: 40 } })
      onEvent?.({ event: 'Progress', data: { chunkLength: 60 } })
    }),
    install: vi.fn(async () => {}),
    ...overrides,
  }
}

async function flushAsync() {
  await vi.advanceTimersByTimeAsync(0)
}

describe('useUpdater', () => {
  let store: Map<string, string>

  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
    mocks.check.mockReset()
    mocks.relaunch.mockReset()
    mocks.relaunch.mockResolvedValue(undefined)
    mocks.isInstalledMode.mockReset()
    mocks.isInstalledMode.mockResolvedValue(true)

    store = new Map()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('downloads first, shows the installing handoff, then installs and relaunches', async () => {
    const update = makeUpdate()
    mocks.check.mockResolvedValue(update)

    const { useUpdater } = await import('./useUpdater')
    const { status, progress, newVersion, checkForUpdate, downloadAndInstall } = useUpdater()

    await checkForUpdate()
    expect(status.value).toBe('available')
    expect(newVersion.value).toBe('2.99.0')

    const running = downloadAndInstall()
    await flushAsync()
    await flushAsync()

    expect(update.download).toHaveBeenCalledOnce()
    expect(progress.value).toBe(100)
    expect(status.value).toBe('installing')
    expect(store.get(PENDING_UPDATE_KEY)).toBe('2.99.0')
    expect(update.install).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1500)
    await running

    expect(update.install).toHaveBeenCalledOnce()
    expect(mocks.relaunch).toHaveBeenCalledOnce()
  })

  it('reports an install failure without leaving the installing state', async () => {
    const update = makeUpdate({
      install: vi.fn(async () => {
        throw new Error('installer failed')
      }),
    })
    mocks.check.mockResolvedValue(update)

    const { useUpdater } = await import('./useUpdater')
    const { status, errorMessage, checkForUpdate, downloadAndInstall } = useUpdater()

    await checkForUpdate()
    const running = downloadAndInstall()
    await flushAsync()
    await flushAsync()
    await vi.advanceTimersByTimeAsync(1500)
    await running

    expect(status.value).toBe('error')
    expect(errorMessage.value).toBe('installer failed')
    expect(mocks.relaunch).not.toHaveBeenCalled()
  })

  it('skips the updater outside an installed build', async () => {
    mocks.isInstalledMode.mockResolvedValue(false)

    const { useUpdater } = await import('./useUpdater')
    const { status, checkForUpdate, downloadAndInstall } = useUpdater()

    await checkForUpdate()
    await downloadAndInstall()

    expect(mocks.check).not.toHaveBeenCalled()
    expect(status.value).toBe('idle')
  })

  it('consumes the pending version once the new build is actually running', async () => {
    const { consumeUpdatedVersion } = await import('./useUpdater')

    store.set(PENDING_UPDATE_KEY, '2.99.0')
    expect(consumeUpdatedVersion('2.99.0')).toBe('2.99.0')
    expect(store.has(PENDING_UPDATE_KEY)).toBe(false)
    expect(consumeUpdatedVersion('2.99.0')).toBeNull()

    store.set(PENDING_UPDATE_KEY, '2.99.0')
    expect(consumeUpdatedVersion('2.98.0')).toBeNull()
    expect(store.has(PENDING_UPDATE_KEY)).toBe(false)
  })
})
