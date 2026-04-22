import { defineFeature, type FeatureDefinition } from "@kumiko/framework/engine";
import { detailQuery } from "./handlers/detail.query";
import { listQuery } from "./handlers/list.query";
import { retryWrite } from "./handlers/retry.write";
import { triggerWrite } from "./handlers/trigger.write";

export function createJobsFeature(): FeatureDefinition {
  return defineFeature("jobs", (r) => {
    r.systemScope();

    const handlers = {
      trigger: r.writeHandler(triggerWrite),
      retry: r.writeHandler(retryWrite),
    };

    const queries = {
      list: r.queryHandler(listQuery),
      detail: r.queryHandler(detailQuery),
    };

    return { handlers, queries };
  });
}
