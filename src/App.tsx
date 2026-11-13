import { Component, lazy, Suspense, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { Building } from './components/Building';
import { ElevatorButtons } from './components/ElevatorButtons';
import { FloorDisplay } from './components/FloorDisplay';
import { Header } from './components/Header';
import { MobileFallback } from './components/MobileFallback';
import { SeoSync } from './components/SeoSync';
import { buildStops, contactLevel, levelLabels } from './content';
import { useCapabilities, wants3D } from './hooks/useCapabilities';
import { useAdminKeyword } from './hooks/useAdminGesture';
import { useSiteContent } from './hooks/useSiteContent';
import { hideBootLoader } from './lib/boot';
import { IN_PREVIEW, startPreviewBridge } from './lib/preview';
import { configureLift, goTo, jumpToHash, refreshLift, setReducedMotion, type LiftMode } from './state/elevator';

// The 3D tower is a separate chunk, loaded only when it will be shown.
const Experience = lazy(() => import('./three/Experience'));

/** Set when this device drew the 3D tower too slowly: the rest of the visit uses the 2D version. */
const SLOW_KEY = 'easyfirst-consulting:3d-too-slow';
function rememberedSlow(): boolean {
  try {
    return sessionStorage.getItem(SLOW_KEY) === '1';
  } catch {
    return false;
  }
}

/** If WebGL fails at runtime, fall back to the 2D version instead of a blank page. */
class SceneBoundary extends Component<{ onFail: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onFail();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export default function App() {
  const content = useSiteContent();
  const caps = useCapabilities();
  const [sceneFailed, setSceneFailed] = useState(false);
  const [sceneReady, setSceneReady] = useState(false);
  const [tooSlow, setTooSlow] = useState(rememberedSlow);
  // ?mode=3d (testing) keeps the 3D tower even on a slow device.
  const slowOff = caps.forced === '3d' ? false : tooSlow;
  const mode: LiftMode =
    wants3D(caps, content.settings.enable3D, content.settings.phone3D) && !sceneFailed && !slowOff ? '3d' : 'flow';
  const onSlow =
    caps.forced === '3d'
      ? undefined
      : () => {
          try {
            sessionStorage.setItem(SLOW_KEY, '1');
          } catch {
            /* remembered for this page only */
          }
          setTooSlow(true);
        };
  // 3D, panel setting on: the page is laid out bottom to top and scrolling up rides the lift up.
  const rise = mode === '3d' && content.settings.scrollUp;
  const stops = useMemo(() => buildStops(content), [content]);
  const labels = useMemo(() => levelLabels(content), [content]);
  useAdminKeyword();

  // Bind the lift engine to the rendered sections whenever the layout changes.
  useLayoutEffect(() => {
    setReducedMotion(caps.reduced);
    configureLift(
      stops,
      stops.map((s) => document.getElementById(s.key)),
      mode,
      { rise },
    );
    document.documentElement.dataset.mode = mode;
    document.documentElement.toggleAttribute('data-rise', rise);
  }, [stops, mode, caps.reduced, rise]);

  useEffect(() => (IN_PREVIEW ? startPreviewBridge() : undefined), []);

  useEffect(() => {
    jumpToHash();
    document.fonts?.ready.then(refreshLift);
  }, []);

  // Hide the logo loader once there is something to look at.
  useEffect(() => {
    if (mode === 'flow' || sceneReady) {
      const t = setTimeout(hideBootLoader, mode === 'flow' ? 150 : 250);
      return () => clearTimeout(t);
    }
    const safety = setTimeout(hideBootLoader, 9000);
    return () => clearTimeout(safety);
  }, [mode, sceneReady]);

  return (
    <>
      <a
        href="#main"
        className="skip-link"
        onClick={(e) => {
          if (!rise) return;
          // The content starts in the lobby, at the bottom of the page (not at the top of <main>).
          e.preventDefault();
          document.getElementById('main')?.focus({ preventScroll: true });
          goTo(0);
        }}
      >
        {content.common.skipLink}
      </a>
      <Header content={content} aside={mode === 'flow' ? <FloorDisplay labels={labels} common={content.common} variant="compact" /> : null} />

      {mode === '3d' && (
        <SceneBoundary onFail={() => setSceneFailed(true)}>
          <Suspense fallback={null}>
            <Experience
              content={content}
              onReady={() => setSceneReady(true)}
              onFail={() => setSceneFailed(true)}
              onSlow={onSlow}
            />
          </Suspense>
        </SceneBoundary>
      )}

      {mode === 'flow' && (
        <MobileFallback stops={stops} top={contactLevel(content)} common={content.common} settings={content.settings} />
      )}

      {mode === '3d' && (
        <>
          <FloorDisplay labels={labels} common={content.common} />
          <ElevatorButtons stops={stops} common={content.common} />
        </>
      )}

      <main id="main" tabIndex={-1} className={`building mode-${mode}${rise ? ' rise' : ''}`}>
        <Building content={content} stops={stops} mode={mode} />
      </main>

      <SeoSync content={content} stops={stops} />
    </>
  );
}
