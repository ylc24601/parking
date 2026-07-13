import { TAIPEI_UTC_OFFSET_HOURS } from '@/lib/allocation/rules'
import { addDaysToIsoDate } from '@/lib/eligibilityStatus'

// "Today" as a YYYY-MM-DD calendar date in Asia/Taipei (UTC+8 year-round, no DST).
// The member page resolves "this week's event" from it: the smallest sunday_date >=
// taipeiToday(now), so Sunday itself still resolves to that day's event all day and
// Monday onward points at next week (development_plan §7 timing is Taipei-local).
export function taipeiToday(now: Date): string {
  const shifted = new Date(now.getTime() + TAIPEI_UTC_OFFSET_HOURS * 3600_000)
  return shifted.toISOString().slice(0, 10)
}

// The upcoming Sunday of the Taipei calendar: the smallest Sunday >= taipeiToday(now),
// so Sunday itself counts as the current week all day. Single source for the Sunday a
// scheduled job targets (ensure-weekly-event, job eventId resolution) and for the Staff
// PIN page's "current Sunday" — NOT getActiveEvent(), whose "latest non-finalized"
// semantics would point at a stale prior week left unfinalized.
export function upcomingSundayISO(now: Date): string {
  const today = taipeiToday(now)
  const [year, month, day] = today.split('-').map(Number)
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay() // 0 = Sunday
  return addDaysToIsoDate(today, (7 - weekday) % 7)
}
