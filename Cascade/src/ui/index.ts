// Barrel for the UI module.
export { buildLayout, isPhoneLayout, type Layout, type PanelId } from './layout';
export {
  createControls, autoThinning, type CameraPreset, type ControlHandlers, type ControlOptions, type Controls, type Quality,
} from './controls';
export { createTimeline, SPEEDS_NS_PER_S, type Timeline, type TimelineHandlers, type TimelineMarker, type TimelineState } from './timeline';
export { ChartsPanel, type ChartTab } from './charts';
export { renderStats, renderStatsEmpty } from './stats';
export { TOUR, createTour, type Tour, type TourHandlers, type TourStep } from './tour';
export { createAbout, type About } from './about';
export { CLASS_COLORS, CLASS_CSS, CLASS_HEX, ACCENT, classColor, type ClassColor } from './colors';
