/** Segmented Status ring math. Each segment maps 1:1 to an active Status record. */

export type StatusRingItem = {
  id: string;
  seen: boolean;
  createdAt: string;
  author: {
    userId: string;
    username: string;
    displayName: string;
    avatarUrl: string | null;
  };
};

export type StatusAuthorRing<T extends StatusRingItem = StatusRingItem> = {
  author: T["author"];
  items: T[];
  unviewed: number;
};

const SVG_SIZE = 36;
const SVG_R = 16;

export function sortStatusesChronological<T extends { createdAt: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const da = Date.parse(a.createdAt) || 0;
    const db = Date.parse(b.createdAt) || 0;
    if (da !== db) return da - db;
    return 0;
  });
}

export function groupStatusesByAuthor<T extends StatusRingItem>(items: T[]): StatusAuthorRing<T>[] {
  const order: string[] = [];
  const map = new Map<string, T[]>();
  for (const item of items) {
    const id = item.author.userId;
    if (!map.has(id)) {
      map.set(id, []);
      order.push(id);
    }
    map.get(id)!.push(item);
  }
  return order.map((id) => {
    const list = sortStatusesChronological(map.get(id)!);
    return {
      author: list[0]!.author,
      items: list,
      unviewed: list.filter((s) => !s.seen).length,
    };
  });
}

export function firstUnviewedId<T extends { id: string; seen: boolean }>(items: T[]): string | null {
  return items.find((s) => !s.seen)?.id ?? items[0]?.id ?? null;
}

export type RingDash = {
  count: number;
  radius: number;
  circumference: number;
  dash: number;
  gap: number;
  size: number;
};

export function ringDash(count: number, radius = SVG_R, gapRatio = 0.07): RingDash {
  const n = Math.max(0, Math.floor(count));
  const circ = 2 * Math.PI * radius;
  if (n <= 0) {
    return { count: 0, radius, circumference: circ, dash: 0, gap: 0, size: SVG_SIZE };
  }
  if (n === 1) {
    return { count: 1, radius, circumference: circ, dash: circ, gap: 0, size: SVG_SIZE };
  }
  const gap = Math.min(circ * gapRatio, circ / (n * 4));
  const dash = Math.max(1, (circ - gap * n) / n);
  return { count: n, radius, circumference: circ, dash, gap, size: SVG_SIZE };
}

export function segmentOffset(index: number, dash: RingDash): number {
  if (dash.count <= 0 || index <= 0) return 0;
  return -(index * (dash.dash + dash.gap));
}

export function ringAriaLabel(name: string, count: number, unviewed: number): string {
  if (count <= 0) return name;
  if (unviewed <= 0) {
    return `${name}, ${count} status update${count === 1 ? "" : "s"}, all viewed`;
  }
  return `${name}, ${count} status update${count === 1 ? "" : "s"}, ${unviewed} unviewed`;
}
