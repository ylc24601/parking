import { releaseExpired } from '@/lib/allocation/release'
import {
  createParkingRepository,
  type OutboxRow,
  type ParkingRepository,
} from '@/server/repositories/parkingRepository'

export interface ReleaseSummary {
  released: number
  broadcastEnqueued: number
}

// Sunday release sweep. Each approved reservation past its own release_deadline_at
// (P3=10:30, P2=10:45, P2 on-the-way=10:55) becomes released_late; when anything is
// released, every still-waiting user is broadcast the freed capacity. Idempotent: a
// re-run releases 0 rows (status guard) and enqueues nothing.
export async function runRelease(
  params: { eventId: string; now?: Date },
  repo: ParkingRepository = createParkingRepository(),
): Promise<ReleaseSummary> {
  const { eventId, now = new Date() } = params
  const nowIso = now.toISOString()

  const reservations = await repo.getReservationsForRelease(eventId)
  const result = releaseExpired(reservations, now)

  // Map the pure broadcast entries (one per waiting user) to outbox rows. The dedupe
  // key carries a per-sweep discriminator so each release tier re-broadcasts, while a
  // re-run at the same instant collides → ON CONFLICT DO NOTHING (idempotent).
  const broadcast: OutboxRow[] = result.outbox.map(o => ({
    dedupe_key: `broadcast:${o.reservation_id}:${nowIso}`,
    template_key: o.template_key,
    user_id: o.user_id,
    reservation_id: o.reservation_id,
    payload: o.payload,
  }))

  const res = await repo.applyRelease(eventId, nowIso, broadcast)
  return { released: res.released, broadcastEnqueued: res.outbox_enqueued }
}
