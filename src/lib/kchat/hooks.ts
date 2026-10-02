import { useQuery } from "@tanstack/react-query";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { getMe } from "./server/profiles";
import { listNotifications } from "./server/more";
import { inboxUnreadCount } from "./server/chat-custom";
import { listStatuses } from "./server/status";
import { groupStatusesByAuthor } from "./status-ring";

export function useMeQuery() {
  const { user } = useCurrentUserState();
  return useQuery({
    queryKey: ["me"],
    queryFn: () => getMe(),
    staleTime: 4_000,
    refetchInterval: 5_000,
    enabled: Boolean(user),
  });
}

export function useUnread(enabled = true) {
  return useQuery({
    queryKey: ["notifications"],
    queryFn: () => listNotifications(),
    refetchInterval: 12_000,
    enabled,
  });
}

export function useInboxUnread(enabled = true) {
  return useQuery({
    queryKey: ["inbox-unread"],
    queryFn: () => inboxUnreadCount(),
    refetchInterval: 4_000,
    enabled,
  });
}

export function useStatuses(enabled = true) {
  return useQuery({
    queryKey: ["statuses"],
    queryFn: () => listStatuses(),
    refetchInterval: 8_000,
    enabled,
  });
}

export function useAuthorStatusRing(userId?: string | null) {
  const q = useStatuses(Boolean(userId));
  const rings = groupStatusesByAuthor(q.data ?? []);
  const ring = userId ? rings.find((r) => r.author.userId === userId) ?? null : null;
  return { ...q, ring };
}