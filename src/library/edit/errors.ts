import { isApiError } from "../../platform";

export function errorMessage(error: unknown, fallback: string): string {
  return isApiError(error) ? error.message : fallback;
}
