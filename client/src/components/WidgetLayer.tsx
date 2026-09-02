/**
 * WidgetLayer — the five floating widgets, mounted once for the whole app.
 *
 * They used to be children of `ConstellationMenu`, which meant they existed
 * only while the map was open. Pinning is the whole point of moving them: a
 * pinned widget is furniture and follows you onto every page, an unpinned one
 * is part of the constellation and leaves with it.
 *
 * A widget is mounted only when it is going to be seen — `mapOpen || pinned` —
 * rather than kept mounted and hidden. Five widgets each holding a live query
 * would otherwise poll all day behind pages that never show them. React Query
 * keeps the cache, so opening the map paints the last answer immediately and
 * refetches behind it; nothing flashes.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  refitWidgetPositions, widgetScale, clampWidgetScale, isWidgetPinned,
  type WidgetKey,
} from "@/lib/constellationLayout";
import { useConstellationLayout } from "@/lib/layoutStore";
import { useConstellationUi } from "@/lib/constellationUiState";
import { DEFAULT_CLOCK_FORMAT, type ClockFormat, type ClockZone } from "@/lib/clockSettings";
import { nodeFocusRect } from "./WidgetChrome";
import ConstellationWidget from "./ConstellationWidget";
import ProjectsWidget from "./ProjectsWidget";
import FlashcardWidget from "./FlashcardWidget";
import ThreatsWidget from "./ThreatsWidget";
import TaskStabilizerWidget from "./TaskStabilizerWidget";

function useViewport() {
  const read = () => ({
    w: document.documentElement.clientWidth  || window.innerWidth,
    h: document.documentElement.clientHeight || window.innerHeight,
  });
  const [dims, setDims] = useState(read);
  useEffect(() => {
    const onResize = () => setDims(read());
    const id = requestAnimationFrame(onResize);
    window.addEventListener("resize", onResize);
    return () => { cancelAnimationFrame(id); window.removeEventListener("resize", onResize); };
  }, []);
  return dims;
}

export default function WidgetLayer() {
  const [layout, setLayout] = useConstellationLayout();
  const { mapOpen, editMode, zoomed } = useConstellationUi();
  const dims = useViewport();

  /**
   * Re-fit every widget to the screen that is actually here.
   *
   * This lived in `ConstellationMenu` while the widgets did, and had to move
   * with them: a pinned widget can now be the first thing drawn on a machine
   * with a different display, long before the map is ever opened. The remap is
   * proportional; each widget still clamps against its own measured box in
   * `useWidgetFit`, which is the pass that knows about height.
   *
   * `refitWidgetPositions` returns its input when nothing moved, and the store
   * ignores a set to the same object — that is what stops this looping on its
   * own write.
   */
  useEffect(() => {
    if (dims.w <= 0 || dims.h <= 0) return;
    setLayout(prev => refitWidgetPositions(prev, dims));
  }, [dims.w, dims.h, setLayout]);

  const focusRect = useMemo(() => nodeFocusRect(dims), [dims.w, dims.h]);

  const handleScale = useCallback((key: WidgetKey, value: number) => {
    setLayout(prev => ({
      ...prev,
      widgetScales: { ...(prev.widgetScales ?? {}), [key]: clampWidgetScale(value) },
    }));
  }, [setLayout]);

  const handlePinned = useCallback((key: WidgetKey, value: boolean) => {
    setLayout(prev => ({
      ...prev,
      widgetPinned: { ...(prev.widgetPinned ?? {}), [key]: value },
    }));
  }, [setLayout]);

  /** Navigating out of a widget should take the map with it. */
  const closeMap = useCallback(() => {
    (window as any).__romeCloseConstellation?.();
  }, []);

  const visible = (key: WidgetKey) => mapOpen || isWidgetPinned(layout, key);

  // Shared by all five. `editing` and the yield rectangle only mean anything
  // while the map is up — a pinned widget on a working page has no camera to
  // get out of the way of and no editor to show grips for.
  const common = (key: WidgetKey) => ({
    scale: widgetScale(layout, key),
    editing: mapOpen && editMode,
    onScaleChange: (s: number) => handleScale(key, s),
    zoomed: mapOpen && zoomed,
    focus: mapOpen ? focusRect : null,
    pinned: isWidgetPinned(layout, key),
    onPinnedChange: (p: boolean) => handlePinned(key, p),
  });

  return (
    <>
      {visible("kronos") && (
        <ConstellationWidget
          pos={layout.widgetPos ?? null}
          collapsed={layout.widgetCollapsed ?? false}
          onPosChange={p => setLayout(prev => ({ ...prev, widgetPos: p }))}
          onCollapsedChange={c => setLayout(prev => ({ ...prev, widgetCollapsed: c }))}
          clockFormat={layout.clockFormat ?? DEFAULT_CLOCK_FORMAT}
          clockTimeZone={layout.clockTimeZone ?? null}
          onClockFormatChange={(format: ClockFormat) => setLayout(prev => ({ ...prev, clockFormat: format }))}
          onClockTimeZoneChange={(zone: ClockZone) => setLayout(prev => ({ ...prev, clockTimeZone: zone }))}
          {...common("kronos")}
        />
      )}

      {visible("taskStabilizer") && (
        <TaskStabilizerWidget
          pos={layout.taskStabilizerWidgetPos ?? null}
          collapsed={layout.taskStabilizerWidgetCollapsed ?? false}
          onPosChange={p => setLayout(prev => ({ ...prev, taskStabilizerWidgetPos: p }))}
          onCollapsedChange={c => setLayout(prev => ({ ...prev, taskStabilizerWidgetCollapsed: c }))}
          {...common("taskStabilizer")}
        />
      )}

      {visible("threats") && (
        <ThreatsWidget
          pos={layout.threatsWidgetPos ?? null}
          collapsed={layout.threatsWidgetCollapsed ?? false}
          onPosChange={p => setLayout(prev => ({ ...prev, threatsWidgetPos: p }))}
          onCollapsedChange={c => setLayout(prev => ({ ...prev, threatsWidgetCollapsed: c }))}
          {...common("threats")}
        />
      )}

      {visible("projects") && (
        <ProjectsWidget
          pos={layout.projectsWidgetPos ?? null}
          collapsed={layout.projectsWidgetCollapsed ?? false}
          onPosChange={p => setLayout(prev => ({ ...prev, projectsWidgetPos: p }))}
          onCollapsedChange={c => setLayout(prev => ({ ...prev, projectsWidgetCollapsed: c }))}
          onClose={closeMap}
          {...common("projects")}
        />
      )}

      {visible("flashcards") && (
        <FlashcardWidget
          pos={layout.flashcardWidgetPos ?? null}
          collapsed={layout.flashcardWidgetCollapsed ?? false}
          onPosChange={p => setLayout(prev => ({ ...prev, flashcardWidgetPos: p }))}
          onCollapsedChange={c => setLayout(prev => ({ ...prev, flashcardWidgetCollapsed: c }))}
          {...common("flashcards")}
        />
      )}
    </>
  );
}
