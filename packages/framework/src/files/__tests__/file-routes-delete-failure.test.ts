import { describe, expect, test } from "bun:test";
import { InternalError, writeFailure } from "../../errors/index.ts";
import { deleteFailureResponseFor } from "../file-routes.ts";

const errorWithStatus = (httpStatus: number) => {
  const { error } = writeFailure(new InternalError({ message: "executor refused" }));
  return { ...error, httpStatus };
};

describe("deleteFailureResponseFor", () => {
  test("a status declared by KumikoError subclasses is passed through", () => {
    const error = errorWithStatus(409);
    expect(deleteFailureResponseFor(error)).toEqual({ status: 409, code: error.code });
  });

  test("a status outside that set falls back to 500", () => {
    const error = errorWithStatus(418);
    expect(deleteFailureResponseFor(error)).toEqual({ status: 500, code: error.code });
  });

  test("a 404 from the executor is masked as not_found", () => {
    expect(deleteFailureResponseFor(errorWithStatus(404))).toEqual({
      status: 404,
      code: "not_found",
    });
  });
});
