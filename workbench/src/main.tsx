import {Component, StrictMode, type ErrorInfo, type ReactNode} from "react";
import {createRoot} from "react-dom/client";
import App from "./App";
import "./styles.css";

interface BoundaryState { error: Error | null }

class WorkbenchErrorBoundary extends Component<{children: ReactNode}, BoundaryState> {
  state: BoundaryState = {error: null};

  static getDerivedStateFromError(error: Error): BoundaryState { return {error}; }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("ModelForge workbench render failed", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    const message = this.state.error.message || "The workbench could not render.";
    const chunkFailure = /chunk|dynamically imported|module script|importing a module/i.test(message);
    const reloadCurrentBuild = (reset = false) => {
      if (reset) {
        sessionStorage.removeItem("modelforge.workbench.activity");
        localStorage.removeItem("modelforge.workbench.cliff");
        localStorage.removeItem("modelforge.workbench.output");
      }
      const target = new URL(window.location.href);
      target.searchParams.set("workbench_reload", String(Date.now()));
      window.location.replace(target);
    };
    return <main className="workbench-fatal" role="alert">
      <div>
        <img src="/favicon.svg" alt="" aria-hidden="true" />
        <span className="eyebrow">Workbench recovery</span>
        <h1>{chunkFailure ? "The workspace was updated" : "The workspace could not render"}</h1>
        <p>{chunkFailure ? "This tab still references an older compiled workspace. Reload it to use the current local build." : message}</p>
        <div>
          <button className="mf-button mf-button-primary mf-button-md" onClick={() => reloadCurrentBuild()}>Reload current build</button>
          <button className="mf-button mf-button-secondary mf-button-md" onClick={() => reloadCurrentBuild(true)}>Reset workspace state</button>
        </div>
        <details><summary>Technical detail</summary><pre>{this.state.error.stack || message}</pre></details>
      </div>
    </main>;
  }
}

const root = document.getElementById("root");
if (!root) throw new Error("ModelForge workbench root is missing");
createRoot(root).render(<StrictMode><WorkbenchErrorBoundary><App /></WorkbenchErrorBoundary></StrictMode>);
