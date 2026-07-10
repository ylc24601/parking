import { TAIPEI_UTC_OFFSET_HOURS } from '@/lib/allocation/rules'

// "Today" as a YYYY-MM-DD calendar date in Asia/Taipei (UTC+8 year-round, no DST).
// The member page resolves "this week's event" from it: the smallest sunday_date >=
// taipeiToday(now), so Sunday itself still resolves to that day's event all day and
// Monday onward points at next week (development_plan §7 timing is Taipei-local).
export function taipeiToday(now: Date): string {
  const shifted = new Date(now.getTime() + TAIPEI_UTC_OFFSET_HOURS * 3600_000)
  return shifted.toISOString().slice(0, 10)
}
