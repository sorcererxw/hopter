import { type ComponentPropsWithoutRef } from "react"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
import {
  ArrowDown01Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  ArrowUp01Icon,
  ArrowUp02Icon as HugeArrowUp02Icon,
  AttachmentIcon as HugeAttachmentIcon,
  Cancel01Icon,
  CheckListIcon,
  CheckmarkCircle02Icon,
  CheckmarkSquare01Icon,
  CircleIcon,
  Copy01Icon,
  Edit02Icon as HugeEdit02Icon,
  File01Icon,
  FileImageIcon,
  FileSearchIcon,
  Folder01Icon,
  FolderGitTwoIcon,
  Folder02Icon,
  Grid02Icon,
  GitBranchIcon,
  Loading03Icon,
  QuillWrite02Icon as HugeQuillWrite02Icon,
  LegalHammerIcon,
  ListTreeIcon,
  MoreHorizontalIcon,
  PanelLeftIcon,
  SidebarLeftIcon as HugeSidebarLeftIcon,
  PanelRightCloseIcon,
  PanelRightIcon,
  PanelRightOpenIcon,
  PenTool01Icon,
  RotateLeft01Icon,
  Search01Icon,
  Settings01Icon,
  Square01Icon,
  Tick02Icon,
  TaskDone01Icon as HugeTaskDone01Icon,
  TestTube02Icon,
  TerminalIcon,
  Wrench01Icon,
  BulbIcon,
  PackageIcon,
  Link01Icon,
  ZapIcon,
} from "@hugeicons/core-free-icons"

type HugeIconProps = Omit<
  ComponentPropsWithoutRef<typeof HugeiconsIcon>,
  "icon"
>

const sizeClassRegex = /\bsize-(\d+(?:\.\d+)?)\b/g

function parseSizeFromClassName(className?: string) {
  if (!className) {
    return { className, size: undefined as number | undefined }
  }

  const match = className.match(sizeClassRegex)
  if (!match || match.length === 0) {
    return { className, size: undefined as number | undefined }
  }

  const sizeValue = parseFloat(match[0].slice(5))
  const size = Number.isFinite(sizeValue) ? sizeValue * 4 : undefined

  return {
    className: className.replace(sizeClassRegex, "").replace(/\s+/g, " ").trim(),
    size,
  }
}

function createHugeIcon(icon: IconSvgElement) {
  return ({ size, className, ...props }: HugeIconProps) => {
    const parsed = parseSizeFromClassName(className)

    const explicitSize =
      typeof size === "number" && Number.isFinite(size)
        ? size
        : typeof size === "string" && /^\d+$/.test(size)
          ? Number(size)
          : undefined

    return (
      <HugeiconsIcon
        icon={icon}
        size={explicitSize ?? parsed.size ?? 24}
        color="currentColor"
        strokeWidth={props.strokeWidth ?? 2}
        className={parsed.className}
        {...props}
      />
    )
  }
}

export const Search = createHugeIcon(Search01Icon)
export const Check = createHugeIcon(CheckmarkSquare01Icon)
export const ChevronDown = createHugeIcon(ArrowDown01Icon)
export const CheckCircle2 = createHugeIcon(CheckmarkCircle02Icon)
export const Circle = createHugeIcon(CircleIcon)
export const ListChecks = createHugeIcon(CheckListIcon)
export const TaskDone01Icon = createHugeIcon(HugeTaskDone01Icon)
export const LoaderCircle = createHugeIcon(Loading03Icon)
export const Copy = createHugeIcon(Copy01Icon)
export const Folder = createHugeIcon(Folder01Icon)
export const FolderOpen = createHugeIcon(Folder02Icon)
export const Tick02 = createHugeIcon(Tick02Icon)
export const Settings = createHugeIcon(Settings01Icon)
export const Edit02Icon = createHugeIcon(HugeEdit02Icon)
export const SquarePen = createHugeIcon(PenTool01Icon)
export const X = createHugeIcon(Cancel01Icon)
export const PanelRightClose = createHugeIcon(PanelRightCloseIcon)
export const PanelRightOpen = createHugeIcon(PanelRightOpenIcon)
export const GitBranch = createHugeIcon(GitBranchIcon)
export const RotateCcw = createHugeIcon(RotateLeft01Icon)
export const ArrowUp = createHugeIcon(ArrowUp01Icon)
export const ArrowUp02Icon = createHugeIcon(HugeArrowUp02Icon)
export const Paperclip = createHugeIcon(HugeAttachmentIcon)
export const AttachmentIcon = createHugeIcon(HugeAttachmentIcon)
export const QuillWrite02Icon = createHugeIcon(HugeQuillWrite02Icon)
export const Square = createHugeIcon(Square01Icon)
export const Zap = createHugeIcon(ZapIcon)
export const MoreHorizontal = createHugeIcon(MoreHorizontalIcon)
export const ArrowLeft = createHugeIcon(ArrowLeft01Icon)
export const SidebarLeftIcon = createHugeIcon(HugeSidebarLeftIcon)
export const PanelLeft = createHugeIcon(PanelLeftIcon)
export const PanelRight = createHugeIcon(PanelRightIcon)
export const Terminal = createHugeIcon(TerminalIcon)
export const FolderGit2 = createHugeIcon(FolderGitTwoIcon)
export const Grid2x2 = createHugeIcon(Grid02Icon)
export const ExternalLink = createHugeIcon(Link01Icon)
export const Lightbulb = createHugeIcon(BulbIcon)
export const Wrench = createHugeIcon(Wrench01Icon)
export const FileImage = createHugeIcon(FileImageIcon)
export const FileText = createHugeIcon(File01Icon)
export const FileSearch = createHugeIcon(FileSearchIcon)
export const ListTree = createHugeIcon(ListTreeIcon)
export const TestTube2 = createHugeIcon(TestTube02Icon)
export const Hammer = createHugeIcon(LegalHammerIcon)
export const Package = createHugeIcon(PackageIcon)
export const ChevronRight = createHugeIcon(ArrowRight01Icon)
export const ArrowDown = createHugeIcon(ArrowDown01Icon)
export const File = createHugeIcon(File01Icon)
