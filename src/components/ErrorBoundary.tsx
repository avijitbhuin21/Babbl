import React from "react";

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("ErrorBoundary caught an unhandled error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="h-screen w-screen flex flex-col items-center justify-center p-8 bg-[#1B211A] text-white font-sans">
          <div className="max-w-lg p-6 rounded-lg bg-[#252d24] border border-[#3a4a3a] shadow-lg">
            <h2 className="text-lg font-semibold text-red-400 mb-2">Something went wrong</h2>
            <p className="text-sm text-gray-300 mb-4">
              An unexpected error occurred while rendering the interface.
            </p>
            <pre className="text-xs text-red-300 bg-[#1a1f19] p-3 rounded overflow-auto max-h-48 whitespace-pre-wrap">
              {this.state.error?.stack || this.state.error?.message || String(this.state.error)}
            </pre>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
