declare module 'lucide-react' {
  import type { ComponentType, SVGProps } from 'react';
  export type LucideIcon = ComponentType<SVGProps<SVGSVGElement> & { size?: string | number; color?: string; strokeWidth?: string | number; absoluteStrokeWidth?: boolean }>;
  export type Icon = LucideIcon;
  export const [key: string]: any;
}
