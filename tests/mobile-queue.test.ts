import { describe, expect, it } from 'vitest'
import { MobileQueue, type MobileQueueSnapshot } from '../src/shared/mobile-queue'
import type { GenerationRequest } from '../src/shared/types'

const request = { prompt: 'cat', seed: 123 } as GenerationRequest
function fixture() {
  let disk: MobileQueueSnapshot | null = null
  let fail = false
  const store = {
    async read() {
      return structuredClone(disk)
    },
    async write(value: MobileQueueSnapshot) {
      if (fail) throw new Error('Storage unavailable')
      disk = structuredClone(value)
    }
  }
  return {
    store,
    fail: () => {
      fail = true
    }
  }
}

describe('mobile queue recovery', () => {
  it('keeps completed work and restores interrupted work as pending without starting it', async () => {
    const { store } = fixture()
    const queue = new MobileQueue(store)
    await queue.restore()
    for (const id of ['complete', 'interrupted', 'waiting']) {
      await queue.enqueue({ id, request, destinationUri: 'content://folder' })
    }
    await queue.start('complete')
    await queue.complete('complete', 'content://folder/image.png')
    await queue.start('interrupted')
    const restored = await new MobileQueue(store).restore()
    expect(restored.jobs.map((job) => job.state)).toEqual(['done', 'pending', 'pending'])
    expect(restored.jobs[1].interrupted).toBe(true)
    expect(restored.jobs[1].request.seed).toBe(123)
    expect(restored.jobs[0].savedImageUri).toBe('content://folder/image.png')
  })

  it('does not mark work complete when durable storage fails', async () => {
    const f = fixture()
    const queue = new MobileQueue(f.store)
    await queue.enqueue({ id: 'one', request, destinationUri: 'content://folder' })
    await queue.start('one')
    f.fail()
    await expect(queue.complete('one', 'content://image')).rejects.toThrow('Storage unavailable')
    expect(queue.getSnapshot().jobs[0].state).toBe('running')
  })

  it('serializes concurrent edits and prevents completed jobs from restarting', async () => {
    const { store } = fixture()
    const queue = new MobileQueue(store)
    await Promise.all(
      ['a', 'b'].map((id) => queue.enqueue({ id, request, destinationUri: 'content://folder' }))
    )
    expect(queue.getSnapshot().jobs).toHaveLength(2)
    await queue.start('a')
    await expect(queue.start('b')).rejects.toThrow('Queue is busy')
    await queue.complete('a', 'content://image')
    await expect(queue.start('a')).rejects.toThrow('Job is not pending')
  })
})
