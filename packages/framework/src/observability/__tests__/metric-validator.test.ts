import { describe, expect, it } from "vitest";
import { buildMetricName, validateLabelKey, validateMetricName } from "../metric-validator";

describe("validateMetricName", () => {
  describe("counter", () => {
    it("accepts _total suffix", () => {
      expect(() => validateMetricName("orders_created_total", "counter")).not.toThrow();
    });

    it("rejects missing _total suffix", () => {
      expect(() => validateMetricName("orders_created", "counter")).toThrow(
        /must end with "_total"/,
      );
    });

    it("rejects camelCase", () => {
      expect(() => validateMetricName("ordersCreatedTotal", "counter")).toThrow(/snake_case/);
    });

    it("rejects leading digit", () => {
      expect(() => validateMetricName("1_orders_total", "counter")).toThrow(/snake_case/);
    });
  });

  describe("histogram", () => {
    it("accepts _seconds suffix", () => {
      expect(() => validateMetricName("http_request_duration_seconds", "histogram")).not.toThrow();
    });

    it("accepts _bytes suffix", () => {
      expect(() => validateMetricName("http_request_body_bytes", "histogram")).not.toThrow();
    });

    it("accepts custom domain unit (_eur)", () => {
      expect(() => validateMetricName("orders_value_eur", "histogram")).not.toThrow();
    });

    it("rejects _total suffix", () => {
      expect(() => validateMetricName("http_request_total", "histogram")).toThrow(
        /must not end with "_total"/,
      );
    });

    it("rejects single word without unit", () => {
      expect(() => validateMetricName("duration", "histogram")).toThrow(/needs a unit suffix/);
    });
  });

  describe("gauge", () => {
    it("accepts plain noun", () => {
      expect(() => validateMetricName("db_pool_active_connections", "gauge")).not.toThrow();
    });

    it("rejects _total suffix", () => {
      expect(() => validateMetricName("active_sessions_total", "gauge")).toThrow(/_total/);
    });

    it("rejects _seconds suffix (suggests histogram)", () => {
      expect(() => validateMetricName("request_duration_seconds", "gauge")).toThrow(/histogram/i);
    });
  });
});

describe("buildMetricName", () => {
  it("prefixes with kumiko_<feature>_", () => {
    expect(buildMetricName("orders", "created_total")).toBe("kumiko_orders_created_total");
  });

  it("rejects non-snake_case feature name", () => {
    expect(() => buildMetricName("Orders", "created_total")).toThrow(/snake_case/);
  });
});

describe("validateLabelKey", () => {
  it("accepts snake_case", () => {
    expect(() => validateLabelKey("error_class")).not.toThrow();
  });

  it("rejects camelCase", () => {
    expect(() => validateLabelKey("errorClass")).toThrow(/snake_case/);
  });

  it("rejects reserved Prometheus keys", () => {
    expect(() => validateLabelKey("le")).toThrow(/reserved/);
    expect(() => validateLabelKey("__name__")).toThrow(/snake_case/);
  });
});
