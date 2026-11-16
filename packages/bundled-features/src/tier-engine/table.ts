import { buildEntityTable } from "@cosmicdrift/kumiko-framework/db";
import { tierAssignmentEntity } from "./entity.ts";

export const tierAssignmentTable = buildEntityTable("tier-assignment", tierAssignmentEntity);
