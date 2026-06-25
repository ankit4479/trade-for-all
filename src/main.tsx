import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App';
import './index.css';

const root = createRoot(document.getElementById('root')!);

// Dev-only internal data dashboard at /admin.
// `import.meta.env.DEV` is a COMPILE-TIME constant: in `vite build` it is
// `false`, so this whole branch — and the dynamic `import('./admin/...')` —
// is dead-code-eliminated by Rollup. The admin UI is therefore never referenced
// from the production entry and never ships in the customer bundle.
// `(import.meta as any).env` mirrors src/App.tsx — this repo has no
// `vite/client` types wired into tsconfig, so we cast to read env vars.
if ((import.meta as any).env.DEV && window.location.pathname.startsWith('/admin')) {
  import('./admin/DataDashboard').then(({default: DataDashboard}) => {
    root.render(
      <StrictMode>
        <DataDashboard />
      </StrictMode>,
    );
  });
} else {
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
