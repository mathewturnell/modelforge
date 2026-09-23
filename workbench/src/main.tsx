import {Component, StrictMode, type ErrorInfo, type ReactNode} from "react";
import {createRoot} from "react-dom/client";
import App from "./App";
import {CacheProvider} from "@emotion/react";
import createCache from "@emotion/cache";
import {CssBaseline, ThemeProvider} from "@mui/material";
import {workbenchTheme} from "./theme";
const styleNonce = document.querySelector<HTMLMetaElement>('meta[name="modelforge-style-nonce"]')?.content;
const styleCache = createCache({key:"modelforge", nonce:styleNonce, prepend:true});
import {bootstrapSessionToken} from "./lib/api";
import "./styles.css";
bootstrapSessionToken();
class ErrorBoundary extends Component<{children: ReactNode}, {error: Error | null}> {
  state = {error: null as Error | null};
  static getDerivedStateFromError(error: Error) { return {error}; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error("Public workbench render failed", error, info.componentStack); }
  render() { return this.state.error ? <main className="fatal" role="alert"><h1>Workbench unavailable</h1><p>{this.state.error.message}</p><button onClick={() => location.reload()}>Reload</button></main> : this.props.children; }
}
const root = document.getElementById("root");
if (!root) throw new Error("ModelForge workbench root is missing");
createRoot(root).render(<StrictMode><CacheProvider value={styleCache}><ThemeProvider theme={workbenchTheme}><CssBaseline/><ErrorBoundary><App /></ErrorBoundary></ThemeProvider></CacheProvider></StrictMode>);
