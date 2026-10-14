import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

class Boundary extends React.Component<{ children: React.ReactNode }, { err: Error | null }> {
  state = { err: null as Error | null };
  static getDerivedStateFromError(err: Error) { return { err }; }
  render() { return this.state.err ? <div className="page"><div className="warn">Something broke: {this.state.err.message}. <button onClick={() => this.setState({ err: null })}>Try again</button></div></div> : this.props.children; }
}
createRoot(document.getElementById('root')!).render(<Boundary><App /></Boundary>);
