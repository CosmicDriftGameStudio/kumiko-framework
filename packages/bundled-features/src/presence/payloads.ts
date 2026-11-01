import {
  PRESENCE_FOCUS_MAX_LENGTH,
  PRESENCE_LIST_MAX_IDS,
} from "@cosmicdrift/kumiko-types/presence-types";
import * as z from "zod";

const ENTITY_NAME_MAX = 64;
const ROW_ID_MAX = 64;
const FOCUS_PATTERN = /^[\w:.-]+$/;

const entity = z.string().min(1).max(ENTITY_NAME_MAX);
const rowId = z.string().min(1).max(ROW_ID_MAX);

export const HeartbeatSchema = z.object({
  entity,
  id: rowId,
  activity: z.enum(["viewing", "editing"]),
  focus: z.string().max(PRESENCE_FOCUS_MAX_LENGTH).regex(FOCUS_PATTERN).optional(),
});

export const LeaveSchema = z.object({ entity, id: rowId });

export const ListSchema = z.object({
  entity,
  ids: z.array(rowId).min(1).max(PRESENCE_LIST_MAX_IDS),
});
