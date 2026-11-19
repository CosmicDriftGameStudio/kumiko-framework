import { describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import {
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "../ui/breadcrumb.tsx";

describe("Breadcrumb", () => {
  test("renders nav list with links, separators, page, ellipsis", () => {
    render(
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="/">Home</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbEllipsis />
          </BreadcrumbItem>
          <BreadcrumbSeparator>
            <span data-testid="custom-sep">/</span>
          </BreadcrumbSeparator>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <a href="/docs">Docs</a>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Current</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>,
    );

    screen.getByLabelText("breadcrumb");
    expect(screen.getByText("Home").getAttribute("href")).toBe("/");
    screen.getByText("More");
    screen.getByTestId("custom-sep");
    expect(screen.getByText("Docs").getAttribute("href")).toBe("/docs");
    const page = screen.getByText("Current");
    expect(page.getAttribute("aria-current")).toBe("page");
    expect(page.getAttribute("aria-disabled")).toBe("true");
  });
});
