import { getRequest } from "@tanstack/react-start/server";
import { requestGeoCountry } from "../billing";

export function liveGeoCountry(): string | null {
  try {
    return requestGeoCountry(getRequest()?.headers ?? null);
  } catch {
    return null;
  }
}
