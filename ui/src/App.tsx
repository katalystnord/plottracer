import { Workspace } from './Workspace.js';

// The Workspace is now a full-height canvas-dominant grid shell (checkpoint
// 39), so App just gives it the whole viewport -- the old padded container +
// <h1> heading were replaced by the shell's own thin top bar (which carries
// the "PlotTracer" title). index.html already sets html/body/#root to
// height:100%.
export function App() {
  return (
    <div style={{ height: '100%' }}>
      <Workspace />
    </div>
  );
}
