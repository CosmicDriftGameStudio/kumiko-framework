import { runInSystemRowLevelSecurityScope } from "@cosmicdrift/kumiko-testing/helpers";
import type { DeliveryService } from "../types.ts";

// Tests call the service from outside a dispatch, so there is no ambient request scope.
export function scopedForTest(service: DeliveryService): DeliveryService {
  return {
    notify: (...args) =>
      runInSystemRowLevelSecurityScope("test calls the delivery service outside a request", () =>
        service.notify(...args),
      ),
  };
}
