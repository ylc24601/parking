// Single source of plate normalization, kept identical across three places:
//   - this TS util (server precheck + client search/dedupe)
//   - the DB generated column vehicles.license_plate_normalized (0001)
//   - the walk_in unique index expression (0009)
// Rule: uppercase, strip every non-alphanumeric character. 'ABC-1234' === 'abc1234'.
export function normalizePlate(plate: string): string {
  return plate.toUpperCase().replace(/[^A-Z0-9]/g, '')
}
