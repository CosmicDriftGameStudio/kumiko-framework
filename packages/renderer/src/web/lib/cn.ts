import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** Standard shadcn helper: `clsx` combines conditional classes,
 * while `tailwind-merge` resolves conflicts (for example,
 * `px-2 px-4` → `px-4`). Primitives use this to merge consumer
 * classes with default classes without duplicates. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
