import type {
  BookDetail,
  Label,
  ReadingStatus,
  SpineStyle,
} from "../../platform";

export type EditSection =
  | "details"
  | "cover"
  | "spine"
  | "status"
  | "online"
  | "danger";

export interface BookPatch {
  id: number;
  title?: string;
  authors?: string[];
  pageCount?: number | null;
  readingStatus?: ReadingStatus;
  labels?: Label[];
  spineStyle?: SpineStyle;
}

export interface EditBookProps {
  bookId: number;
  initialDetail: BookDetail;
  onClose: () => void;
  onDetailChanged: (detail: BookDetail) => void;
  onBookChanged: (patch: BookPatch) => void;
  onLabelsChanged: () => void;
  onDeleted: (bookId: number) => void;
}
