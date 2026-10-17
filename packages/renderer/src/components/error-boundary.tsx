import { ERROR_BOUNDARY_LOG_MARKER } from "@cosmicdrift/kumiko-types/error-boundary";
import { Component, type ErrorInfo, type ReactNode } from "react";

export type ErrorBoundaryFallbackProps = {
  readonly error: Error;
  readonly reset: () => void;
};

export type ErrorBoundaryProps = {
  readonly children: ReactNode;
  readonly fallback: (props: ErrorBoundaryFallbackProps) => ReactNode;
  /** Prefix for the logged message, e.g. "screen" or "root". */
  readonly scope: string;
  /** Called after the default console.error log, e.g. to forward to telemetry. */
  readonly onError?: (error: Error, info: ErrorInfo) => void;
};

type ErrorBoundaryState = { readonly error: Error | undefined };

function toError(thrown: unknown): Error {
  return thrown instanceof Error ? thrown : new Error(String(thrown));
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: undefined };

  static getDerivedStateFromError(thrown: unknown): ErrorBoundaryState {
    return { error: toError(thrown) };
  }

  override componentDidCatch(thrown: unknown, info: ErrorInfo): void {
    const error = toError(thrown);
    this.logCaught(error, info.componentStack);
    try {
      this.props.onError?.(error, info);
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
    this.setState({ error: undefined });
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (error === undefined) return this.props.children;
    return this.props.fallback({ error, reset: this.reset });
  }
}
