import type { GenerationRequest } from './types'

export interface MobileJob {
  id: string
  request: GenerationRequest
  destinationUri: string
  state: 'pending' | 'running' | 'done' | 'cancelled'
  savedImageUri?: string
  interrupted?: boolean
}

export interface MobileQueueSnapshot {
  version: 1
  jobs: MobileJob[]
}

/** The native store must commit a snapshot atomically before resolving. */
export interface MobileQueueStore {
  read(): Promise<MobileQueueSnapshot | null>
  write(snapshot: MobileQueueSnapshot): Promise<void>
}

/** Persistence only: restoring a queue must never send a generation request. */
export class MobileQueue {
  private snapshot: MobileQueueSnapshot = { version: 1, jobs: [] }
  private operations: Promise<unknown> = Promise.resolve()

  constructor(private readonly store: MobileQueueStore) {}

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.operations.then(operation)
    this.operations = next.catch(() => undefined)
    return next
  }

  async restore(): Promise<MobileQueueSnapshot> {
    return this.serialize(async () => {
      const saved = await this.store.read()
      if (saved && (saved.version !== 1 || !Array.isArray(saved.jobs))) {
        throw new Error('Unsupported mobile queue snapshot')
      }
      const next = structuredClone(saved ?? { version: 1 as const, jobs: [] })
      for (const job of next.jobs) {
        if (job.state === 'running') {
          job.state = 'pending'
          job.interrupted = true
        }
      }
      await this.store.write(next)
      this.snapshot = next
      return structuredClone(next)
    })
  }

  private update(change: (jobs: MobileJob[]) => void): Promise<void> {
    return this.serialize(async () => {
      const next = structuredClone(this.snapshot)
      change(next.jobs)
      await this.store.write(next)
      this.snapshot = next
    })
  }

  enqueue(job: Pick<MobileJob, 'id' | 'request' | 'destinationUri'>): Promise<void> {
    const copy = structuredClone(job)
    return this.update((jobs) => {
      if (jobs.some((item) => item.id === copy.id)) throw new Error('Duplicate mobile job')
      jobs.push({ ...copy, state: 'pending' })
    })
  }

  /** Called only by an explicit user resume action, before network submission. */
  start(id: string): Promise<void> {
    return this.update((jobs) => {
      const job = jobs.find((item) => item.id === id)
      if (!job || job.state !== 'pending') throw new Error('Job is not pending')
      if (jobs.some((item) => item.state === 'running')) throw new Error('Queue is busy')
      job.state = 'running'
    })
  }

  /** Only call after both image bytes and the image catalog record are durable. */
  complete(id: string, savedImageUri: string): Promise<void> {
    return this.update((jobs) => {
      const job = jobs.find((item) => item.id === id)
      if (!job || job.state !== 'running' || !savedImageUri) {
        throw new Error('Cannot complete an unsaved job')
      }
      job.savedImageUri = savedImageUri
      job.state = 'done'
      delete job.interrupted
    })
  }

  getSnapshot(): MobileQueueSnapshot {
    return structuredClone(this.snapshot)
  }
}
