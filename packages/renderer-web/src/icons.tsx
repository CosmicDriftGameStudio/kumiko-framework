// Icon registry: symbolic `NavIconKey` → lucide-react component. `NavIconKey`
// is the closed vocabulary a feature author can write (packages/types/src/
// nav-icon.ts); `satisfies` below makes this map a compile-time drift
// guard — a key added to one without the other fails the build.
//
// Runtime data (provider-supplied nav/action icons) is only typed as plain
// `string` at the resolved-tree layer, so an unknown key can still show up
// at runtime on occasion — `Icon` falls back to rendering the raw key as
// text rather than crashing, mirroring the old `ActionGlyph` behavior in
// nav-tree.tsx.
//
// Buttons resolve icons through the same map — importing it from the nav
// layout module would couple them to the sidebar.
import type { NavIconKey } from "@cosmicdrift/kumiko-framework/ui-types";
import {
  AlertTriangle,
  Archive,
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Bell,
  BookOpen,
  Building,
  Calculator,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Clock,
  Coins,
  Copy,
  CreditCard,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
  Filter,
  Flag,
  Folder,
  FolderOpen,
  Gauge,
  Hash,
  Home,
  Info,
  KeyRound,
  Languages,
  Layers,
  LayoutDashboard,
  LayoutGrid,
  LineChart,
  Link,
  List,
  Loader2,
  Lock,
  Mail,
  MapPin,
  MoreHorizontal,
  MoreVertical,
  Package,
  Palette,
  Pencil,
  Phone,
  PiggyBank,
  Plus,
  Printer,
  Receipt,
  RefreshCw,
  Rocket,
  Save,
  Search,
  Send,
  Server,
  Settings,
  Share2,
  Shield,
  ShieldCheck,
  Sparkles,
  Star,
  Table,
  Tag,
  Trash2,
  TrendingUp,
  Undo2,
  Upload,
  User,
  Users,
  Wallet,
  Wand2,
  X,
  XCircle,
} from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "./lib/cn";

export const NAV_ICONS = {
  dashboard: LayoutDashboard,
  "layout-grid": LayoutGrid,
  "book-open": BookOpen,
  "clipboard-list": ClipboardList,
  package: Package,
  gauge: Gauge,
  list: List,
  table: Table,
  layers: Layers,
  building: Building,
  calculator: Calculator,
  wallet: Wallet,
  coins: Coins,
  "credit-card": CreditCard,
  "piggy-bank": PiggyBank,
  receipt: Receipt,
  chart: LineChart,
  "bar-chart": BarChart3,
  trending: TrendingUp,
  sparkles: Sparkles,
  wand: Wand2,
  calendar: CalendarDays,
  file: FileText,
  folder: Folder,
  "folder-open": FolderOpen,
  home: Home,
  bell: Bell,
  shield: Shield,
  "shield-check": ShieldCheck,
  send: Send,
  settings: Settings,
  users: Users,
  user: User,
  search: Search,
  tag: Tag,
  key: KeyRound,
  link: Link,
  palette: Palette,
  share: Share2,
  server: Server,
  mail: Mail,
  lock: Lock,
  hash: Hash,
  download: Download,
  upload: Upload,
  rocket: Rocket,
  // Was imported but never registered — `icon: "plus"` silently fell back.
  plus: Plus,
  languages: Languages,
  trash: Trash2,
  x: X,
  check: Check,
  "arrow-left": ArrowLeft,
  "arrow-right": ArrowRight,
  copy: Copy,
  pencil: Pencil,
  eye: Eye,
  "eye-off": EyeOff,
  filter: Filter,
  refresh: RefreshCw,
  "more-horizontal": MoreHorizontal,
  "more-vertical": MoreVertical,
  "external-link": ExternalLink,
  "chevron-down": ChevronDown,
  "chevron-right": ChevronRight,
  save: Save,
  undo: Undo2,
  archive: Archive,
  star: Star,
  flag: Flag,
  clock: Clock,
  "map-pin": MapPin,
  phone: Phone,
  printer: Printer,
  "alert-triangle": AlertTriangle,
  info: Info,
  "check-circle": CheckCircle2,
  "x-circle": XCircle,
  loader: Loader2,
} as const satisfies Readonly<Record<NavIconKey, typeof Folder>>;

// Widened alias for runtime lookups against the plain `string` icon keys
// resolved-tree nodes carry — not the closed NavIconKey union NAV_ICONS
// itself is typed against.
const ICON_LOOKUP: Readonly<Record<string, typeof Folder | undefined>> = NAV_ICONS;

export function Icon({
  name,
  className,
}: {
  readonly name: NavIconKey;
  readonly className?: string;
}): ReactNode {
  const LucideIcon = Object.hasOwn(NAV_ICONS, name) ? ICON_LOOKUP[name] : undefined;
  if (LucideIcon !== undefined) return <LucideIcon aria-hidden="true" className={className} />;
  return (
    <span aria-hidden="true" className={cn("text-xs", className)}>
      {name}
    </span>
  );
}
