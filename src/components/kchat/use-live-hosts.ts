import { useQuery } from "@tanstack/react-query";
import { listLiveHosts } from "@/lib/kchat/server/live-session";

/** Hosts who currently have a live session. Shared across avatars. */
export function useLiveHostMap() {
  const q = useQuery({
    queryKey: ["live-hosts"],
    queryFn: () => listLiveHosts(),
    staleTime: 12_000,
    refetchInterval: 20_000,
  });
  const map = new Map<string, string>();
  for (const h of q.data ?? []) map.set(h.userId, h.streamId);
  return map;
}
