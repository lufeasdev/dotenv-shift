/** A readable message for anything thrown. */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
