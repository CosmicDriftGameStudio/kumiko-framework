import { ERROR_BOUNDARY_LOG_MARKER } from "@cosmicdrift/kumiko-types/error-boundary";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { createErrorId } from "./error-id.ts";

export type ErrorBoundaryFallbackProps = {
  readonly error: Error;
  /** Shown to the user so a support request can be matched to the report. */
  readonly errorId: string;
  readonly reset: () => void;
};

export type ErrorBoundaryProps = {
  readonly children: ReactNode;
  readonly fallback: (props: ErrorBoundaryFallbackProps) => ReactNode;
  /** Prefix for the logged message, e.g. "screen" or "root". */
  readonly scope: string;
  /** Called after the default console.error log, e.g. to forward to telemetry. */
  readonly onError?: (error: Error, info: ErrorInfo, context: { readonly errorId: string }) => void;
};

type ErrorBoundaryState = {
  readonly caught: { readonly error: Error; readonly errorId: string } | undefined;
};

function toError(thrown: unknown): Error {
  return thrown instanceof Error ? thrown : new Error(String(thrown));
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { caught: undefined };

  static getDerivedStateFromError(thrown: unknown): ErrorBoundaryState {
    return { caught: { error: toError(thrown), errorId: createErrorId() } };
  }

  override componentDidCatch(thrown: unknown, info: ErrorInfo): void {
    const error = toError(thrown);
    const errorId = this.state.caught?.errorId ?? createErrorId();
    this.logCaught(error, info.componentStack);
    try {
      this.props.onError?.(error, info, { errorId });
    } catch (handlerError) {
      // A throw escaping componentDidCatch hands the error to the next boundary up, so a broken telemetry hook would replace the screen card with the root fallback.
      this.logCaught(toError(handlerError), "onError handler threw");
    }
  }

  private logCaught(error: Error, detail: string | null | undefined): void {
    // biome-ignore lint/suspicious/noConsole: the client has no logger and the boundary must not swallow the error; the e2e fixture detects boundary failures via this exact console.error line
    console.error(`[kumiko] ${this.props.scope} ${ERROR_BOUNDARY_LOG_MARKER}:`, error, detail);
  }

  private reset = (): void => {
    this.setState({ caught: undefined });
  };

  override render(): ReactNode {
    const { caught } = this.state;
    if (caught === undefined) return this.props.children;
    return this.props.fallback({ ...caught, reset: this.reset });
  }
}
