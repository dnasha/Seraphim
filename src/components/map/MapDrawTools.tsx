import React, { useCallback, useEffect, useRef, useState } from 'react';
import type * as maplibregl from 'maplibre-gl';
import {
  TerraDraw,
  TerraDrawSelectMode,
  TerraDrawPolygonMode,
  TerraDrawLineStringMode,
  TerraDrawRectangleMode,
  TerraDrawCircleMode,
  TerraDrawPointMode,
} from 'terra-draw';
import { TerraDrawMapLibreGLAdapter } from 'terra-draw-maplibre-gl-adapter';
import {
  area as turfArea,
  booleanPointInPolygon,
  distance as turfDistance,
  length as turfLength,
  point as turfPoint,
  pointToLineDistance,
} from '@turf/turf';
import styles from './MapDrawTools.module.css';
import { hasFeature, type UserTier } from '@/lib/entitlements';
import { GatedButton } from '@/components/ui/FeatureGate';
import { DragFriendlyFreehandLineStringMode } from './draw/DragFriendlyFreehandLineStringMode';
import { tessellateFreehandCoordinates, type FreehandCoordinate } from './draw/freehandGeometry';
import { TextMarker } from './draw/TextMarker';
import { DrawingActionButton } from './draw/DrawingActionButton';
import { MAX_IMPORT_BYTES } from './draw/importValidation';
import { DrawingHistory, drawingDocument, drawingShortcut, emptyDrawingDocument, type DrawFeatures, type DrawingDocument } from './draw/drawingHistory';
import { appendDrawingImport, duplicateDrawing, newDrawingId, replaceDrawFeatures, DRAW_COORDINATE_PRECISION } from './draw/drawingOperations';
import {
  type TextAnnotation,
  readDrawStorage,
  hasSavedDrawings,
  drawingStorageKey,
  persistDrawState,
  clearPersistedDrawState,
} from './draw/drawPersistence';

interface MapDrawToolsProps {
  mapRef: React.MutableRefObject<maplibregl.Map | null>;
  mapReady: boolean;
  isOpen: boolean;
  userTier?: UserTier;
  ownerId?: string | null;
  onClose?: () => void;
}

const COLORS = ['#5f62ec', '#ef4444', '#10b981', '#f59e0b', '#3b82f6', '#ffffff', '#000000'];
const SIZES = [2, 4, 8];
const MIN_DRAW_SIZE = 1;
const MAX_DRAW_SIZE = 50;
const FREEHAND_OVERLAY_SOURCE_ID = 'experiment-drawing-history-freehand-source';
const FREEHAND_OVERLAY_LAYER_ID = 'experiment-drawing-history-freehand-layer';

const hasMapStyleObject = (map: maplibregl.Map): boolean => {
  return Boolean((map as maplibregl.Map & { style?: unknown }).style);
};

const getTerraDrawArtifactIds = (map: maplibregl.Map): { layerIds: string[]; sourceIds: string[] } => {
  if (!hasMapStyleObject(map)) {
    return { layerIds: [], sourceIds: [] };
  }

  try {
    const style = typeof map.getStyle === 'function' ? map.getStyle() : null;
    if (!style) return { layerIds: [], sourceIds: [] };

    const layerIds = (style.layers || [])
      .map((layer) => layer.id)
      .filter((id): id is string => typeof id === 'string' && id.startsWith('experiment-drawing-history-'));

    const sourceIds = Object.keys(style.sources || {})
      .filter((id) => id.startsWith('experiment-drawing-history-'));

    return { layerIds, sourceIds };
  } catch {
    return { layerIds: [], sourceIds: [] };
  }
};

const removeStaleTerraDrawArtifacts = (map: maplibregl.Map) => {
  const { layerIds, sourceIds } = getTerraDrawArtifactIds(map);

  for (const layerId of layerIds) {
    try {
      if (typeof map.getLayer === 'function' && map.getLayer(layerId)) {
        map.removeLayer(layerId);
      }
    } catch {
      // Map style can mutate during teardown; best effort cleanup avoids duplicate-source crashes.
    }
  }

  for (const sourceId of sourceIds) {
    try {
      if (typeof map.getSource === 'function' && map.getSource(sourceId)) {
        map.removeSource(sourceId);
      }
    } catch {
      // Map style can mutate during teardown; best effort cleanup avoids duplicate-source crashes.
    }
  }
};

const stopTerraDrawSafely = (draw: TerraDraw, map: maplibregl.Map) => {
  if (!hasMapStyleObject(map)) return;
  try {
    draw.stop();
  } catch {
    // Ignore teardown races when the underlying adapter map internals are already disposed.
  }
};

// Modes that own drag gestures while active instead of allowing the map to pan.
const TOUCH_DRAW_MODES = new Set(['freehand-linestring', 'rectangle', 'circle', 'eraser']);

export default function MapDrawTools(props: MapDrawToolsProps) {
  // A different account gets a fresh editor immediately, including portals and async work.
  return <DrawingEditor key={`${props.ownerId ?? 'guest'}:${(props.userTier ?? 'guest') === 'guest' ? 'guest' : 'account'}`} {...props} />;
}

function DrawingEditor({ mapRef, mapReady, isOpen, userTier = 'guest', ownerId, onClose }: MapDrawToolsProps) {
  const drawRef = useRef<TerraDraw | null>(null);
  const [activeMode, setActiveMode] = useState<string>('static');
  const activeModeRef = useRef(activeMode);
  const isOpenRef = useRef(isOpen);
  const calculateMeasurementRef = useRef<(() => void) | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [activeColor, setActiveColor] = useState<string>(COLORS[0]);
  const [activeSize, setActiveSize] = useState<number>(SIZES[1]);
  const [activeFill, setActiveFill] = useState<boolean>(true);
  const [activeFillOpacity, setActiveFillOpacity] = useState<number>(40);
  const [selectedFeatureId, setSelectedFeatureId] = useState<string | null>(null);
  const [initialStorage] = useState(() => readDrawStorage(userTier === 'guest' ? null : ownerId));
  const [textAnnotations, setTextAnnotations] = useState<TextAnnotation[]>(initialStorage.document?.textAnnotations ?? []);
  const persistentFeaturesRef = useRef<DrawFeatures>(initialStorage.document?.drawFeatures ?? []);
  const textAnnotationsRef = useRef(textAnnotations);
  const [history] = useState(() => new DrawingHistory(initialStorage.document ?? emptyDrawingDocument()));
  const [, refreshHistory] = useState(0);
  const [storageError, setStorageError] = useState<string | null>(initialStorage.error);
  const [legacyAvailable, setLegacyAvailable] = useState(() => Boolean(ownerId && hasSavedDrawings()));
  const suppressHistoryRef = useRef(false);
  const pointerGestureRef = useRef(false);
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const readerRef = useRef<FileReader | null>(null);
  const mountedRef = useRef(true);
  const selectedIdRef = useRef<string | null>(null);
  const selectedTextRef = useRef(false);
  const [selectedTextId, setSelectedTextId] = useState<string | null>(null);
  const [autoFocusTextId, setAutoFocusTextId] = useState<string | null>(null);
  const captureDocument = useCallback(() => drawingDocument(drawRef.current?.getSnapshot() ?? persistentFeaturesRef.current,
    textAnnotationsRef.current), []);
  const saveDocument = useCallback((document: DrawingDocument) => {
    persistentFeaturesRef.current = document.drawFeatures;
    const error = userTier === 'guest' ? null : (document.drawFeatures.length || document.textAnnotations.length
      ? persistDrawState(document.drawFeatures, document.textAnnotations, ownerId) : clearPersistedDrawState(ownerId));
    if (mountedRef.current) setStorageError(error);
  }, [ownerId, userTier]);
  const commitOperation = useCallback((label: string) => {
    if (suppressHistoryRef.current || !mountedRef.current) return;
    const document = captureDocument();
    if (history.commit(document, label)) {
      saveDocument(document);
      refreshHistory(version => version + 1);
    }
  }, [captureDocument, history, saveDocument]);
  const flushPending = useCallback(() => {
    if (pendingTimerRef.current !== null) {
      clearTimeout(pendingTimerRef.current);
      pendingTimerRef.current = null;
    }
    commitOperation('Edit');
  }, [commitOperation]);
  const scheduleEditCommit = () => {
    if (pendingTimerRef.current !== null) clearTimeout(pendingTimerRef.current);
    pendingTimerRef.current = setTimeout(() => { pendingTimerRef.current = null; commitOperation('Style'); }, 400);
  };
  const clearSelection = useCallback(() => {
    selectedIdRef.current = null;
    selectedTextRef.current = false;
    setSelectedFeatureId(null);
    setSelectedTextId(null);
    setAutoFocusTextId(null);
  }, []);
  const restoreDocument = useCallback((document: DrawingDocument): boolean => {
    if (!drawRef.current) return false;
    const selection = { id: selectedIdRef.current, text: selectedTextRef.current };
    suppressHistoryRef.current = true;
    try {
      replaceDrawFeatures(drawRef.current, document.drawFeatures);
      textAnnotationsRef.current = structuredClone(document.textAnnotations);
      setTextAnnotations(textAnnotationsRef.current);
      persistentFeaturesRef.current = structuredClone(document.drawFeatures);
      clearSelection();
      const mode = isOpen ? activeModeRef.current : 'static';
      drawRef.current.setMode(mode === 'text' || mode === 'eraser' ? 'static' : mode);
      calculateMeasurementRef.current?.();
      return true;
    } catch (error) {
      const mode = isOpen ? activeModeRef.current : 'static';
      drawRef.current.setMode(mode === 'text' || mode === 'eraser' ? 'static' : mode);
      if (selection.id && !selection.text && mode === 'select') drawRef.current.selectFeature(selection.id);
      setImportError(error instanceof Error ? error.message : 'Drawings could not be restored.');
      return false;
    } finally { suppressHistoryRef.current = false; }
  }, [clearSelection, isOpen]);
  const applyDocument = (document: DrawingDocument, label: string) => {
    if (restoreDocument(document)) commitOperation(label);
  };
  const handleHistory = useCallback((direction: 'undo' | 'redo') => {
    flushPending();
    const target = direction === 'undo' ? history.undoDocument : history.redoDocument;
    if (!target || !restoreDocument(target)) return;
    if (direction === 'undo') history.undo(); else history.redo();
    saveDocument(target);
    refreshHistory(version => version + 1);
  }, [flushPending, history, restoreDocument, saveDocument]);
  const [hasPickedCustomColor, setHasPickedCustomColor] = useState(false);
  const [customPickerColor, setCustomPickerColor] = useState<string>('#8b5cf6');
  const colorRef = useRef(activeColor);
  const sizeRef = useRef(activeSize);
  const fillRef = useRef(activeFill);
  const fillOpacityRef = useRef(activeFillOpacity);
  
  useEffect(() => { colorRef.current = activeColor; }, [activeColor]);
  useEffect(() => { sizeRef.current = activeSize; }, [activeSize]);
  useEffect(() => { fillRef.current = activeFill; }, [activeFill]);
  useEffect(() => { fillOpacityRef.current = activeFillOpacity; }, [activeFillOpacity]);

  const applyStyle = (values: { color?: string; size?: number; fill?: boolean; fillOpacity?: number }) => {
    if (!selectedIdRef.current || selectedTextRef.current || !drawRef.current) return;
    const feature = drawRef.current.getSnapshotFeature(selectedIdRef.current);
    if (!feature || Object.entries(values).every(([key, value]) => feature.properties[key] === value)) return;
    if (history.discardRedo()) refreshHistory(version => version + 1);
    drawRef.current.updateFeatureProperties(selectedIdRef.current, values);
    saveDocument(captureDocument());
    scheduleEditCommit();
  };
  const changeColor = (color: string) => { setActiveColor(color); colorRef.current = color; applyStyle({ color }); };
  const changeSize = (size: number) => { setActiveSize(size); sizeRef.current = size; applyStyle({ size }); };
  const changeFill = (fill: boolean) => {
    setActiveFill(fill); fillRef.current = fill;
    applyStyle({ fill, fillOpacity: fill ? fillOpacityRef.current / 100 : 0 });
  };
  const changeOpacity = (opacity: number) => {
    setActiveFillOpacity(opacity); fillOpacityRef.current = opacity;
    applyStyle({ fillOpacity: fillRef.current ? opacity / 100 : 0 });
  };

  const [isCollapsed, setIsCollapsed] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined' && window.innerWidth <= 860) {
      const timer = setTimeout(() => setIsCollapsed(true), 0);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, []);

  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const draggingRef = useRef({ isDragging: false, startX: 0, startY: 0, initialX: 0, initialY: 0 });

  const handleMouseDown = (e: React.MouseEvent) => {
    if (window.innerWidth <= 860 || e.button !== 0) return;

    const target = e.target as HTMLElement;
    const isInteractive = target.closest('button, input, select, textarea, label, [role="button"]');
    if (isInteractive) return;

    e.preventDefault();
    
    if (wrapperRef.current) {
      const rect = wrapperRef.current.getBoundingClientRect();
      const parent = wrapperRef.current.offsetParent;
      const parentRect = parent ? parent.getBoundingClientRect() : { left: 0, top: 0 };
      const currentX = rect.left - parentRect.left;
      const currentY = rect.top - parentRect.top;

      draggingRef.current = {
        isDragging: true,
        startX: e.clientX,
        startY: e.clientY,
        initialX: position ? position.x : currentX,
        initialY: position ? position.y : currentY,
      };
      
      if (!position) {
        setPosition({ x: currentX, y: currentY });
      }
    }
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!draggingRef.current.isDragging) return;
      
      const deltaX = e.clientX - draggingRef.current.startX;
      const deltaY = e.clientY - draggingRef.current.startY;
      
      setPosition({
        x: draggingRef.current.initialX + deltaX,
        y: draggingRef.current.initialY + deltaY,
      });
    };

    const handleMouseUp = () => {
      draggingRef.current.isDragging = false;
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [position]);

  useEffect(() => {
    if (!isOpen) {
      const timer = setTimeout(() => setPosition(null), 0);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [isOpen]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleResize = () => {
      setPosition(null);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const [measurement, setMeasurement] = useState<{ value: number; unit: string; type: 'area' | 'distance' } | null>(null);

  const textModeRef = useRef(false);
  useEffect(() => { isOpenRef.current = isOpen; }, [isOpen]);

  useEffect(() => { 
    activeModeRef.current = activeMode; 
    if (calculateMeasurementRef.current) {
      calculateMeasurementRef.current();
    }

    const map = mapRef.current;
    if (!map) return;

    const canvas = map.getCanvas();
    const previousTouchAction = canvas.style.touchAction;
    const ownsDragGesture = isOpen && TOUCH_DRAW_MODES.has(activeMode);

    if (ownsDragGesture) {
      map.dragPan.disable();
      map.touchZoomRotate.disable();
      if (map.touchPitch) map.touchPitch.disable();
      // Prevent the browser from cancelling the PointerEvent stream to begin a
      // page/map gesture. Terra Draw can then handle mouse, pen and touch alike.
      canvas.style.touchAction = 'none';
    } else {
      map.dragPan.enable();
      map.touchZoomRotate.enable();
      if (map.touchPitch) map.touchPitch.enable();
      canvas.style.touchAction = previousTouchAction;
    }

    return () => {
      canvas.style.touchAction = previousTouchAction;
      if (ownsDragGesture) {
        map.dragPan.enable();
        map.touchZoomRotate.enable();
        if (map.touchPitch) map.touchPitch.enable();
      }
    };
  }, [activeMode, isOpen, mapRef, mapReady]);
  
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      // Current text is already saved; cancel pending work for the departing account.
      if (pendingTimerRef.current !== null) clearTimeout(pendingTimerRef.current);
      readerRef.current?.abort();
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!ownerId) return;
    const onStorage = (event: StorageEvent) => {
      if ((event.key === drawingStorageKey(ownerId) || event.key === null) && event.newValue === null) {
        if (pendingTimerRef.current !== null) clearTimeout(pendingTimerRef.current);
        readerRef.current?.abort();
        pendingTimerRef.current = null;
        history.reset(emptyDrawingDocument());
        // Deletion in another tab clears private UI and session history as well.
        if (!restoreDocument(emptyDrawingDocument())) {
          persistentFeaturesRef.current = [];
          textAnnotationsRef.current = [];
          setTextAnnotations([]);
          clearSelection();
        }
        refreshHistory(version => version + 1);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [ownerId, history, restoreDocument, clearSelection]);

  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const map = mapRef.current;

    if (drawRef.current) {
      stopTerraDrawSafely(drawRef.current, map);
      drawRef.current = null;
    }

    removeStaleTerraDrawArtifacts(map);

    const adapterPrefixId = `experiment-drawing-history-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const adapter = new TerraDrawMapLibreGLAdapter({ map, prefixId: adapterPrefixId, coordinatePrecision: DRAW_COORDINATE_PRECISION });

    type StyledFeature = { properties?: { color?: string; size?: number; fill?: boolean; fillOpacity?: number } };

    const polygonStyles = {
      fillColor: (feature: StyledFeature) => (feature.properties?.color as `#${string}`) || colorRef.current as `#${string}`,
      fillOpacity: (feature: StyledFeature) => {
        const props = feature.properties as { fill?: boolean; fillOpacity?: number } | undefined;
        if (props && props.fill !== undefined) {
          if (!props.fill) return 0;
          return props.fillOpacity !== undefined ? props.fillOpacity : 0.4;
        }
        return fillRef.current ? (fillOpacityRef.current / 100) : 0;
      },
      outlineColor: (feature: StyledFeature) => (feature.properties?.color as `#${string}`) || colorRef.current as `#${string}`,
      outlineWidth: (feature: StyledFeature) => feature.properties?.size || sizeRef.current,
      zIndex: 10,
    };

    const lineStyles = {
      lineStringColor: (feature: StyledFeature) => (feature.properties?.color as `#${string}`) || colorRef.current as `#${string}`,
      lineStringWidth: (feature: StyledFeature) => feature.properties?.size || sizeRef.current,
      lineStringOpacity: 1,
      closingPointColor: (feature: StyledFeature) => (feature.properties?.color as `#${string}`) || colorRef.current as `#${string}`,
      closingPointOutlineColor: (feature: StyledFeature) => (feature.properties?.color as `#${string}`) || colorRef.current as `#${string}`,
      closingPointOpacity: 1,
      closingPointWidth: (feature: StyledFeature) => feature.properties?.size || sizeRef.current,
      closingPointOutlineWidth: 1,
      closingPointOutlineOpacity: 1,
      zIndex: 20,
    };

    const rulerStyles = {
      ...lineStyles,
      lineStringDash: [5, 5] as [number, number],
      zIndex: 30,
    };

    const sketchStyles = {
      lineStringColor: (feature: StyledFeature) => (feature.properties?.color as `#${string}`) || colorRef.current as `#${string}`,
      lineStringWidth: (feature: StyledFeature) => feature.properties?.size || sizeRef.current,
      lineStringOpacity: 1,
      zIndex: 40,
    };

    const pointStyles = {
      pointColor: (feature: StyledFeature) => (feature.properties?.color as `#${string}`) || colorRef.current as `#${string}`,
      pointWidth: (feature: StyledFeature) => ((feature.properties?.size || sizeRef.current) * 3),
      pointOpacity: 1,
      pointOutlineColor: '#ffffff' as `#${string}`,
      pointOutlineOpacity: 1,
      pointOutlineWidth: 2,
      editedPointColor: (feature: StyledFeature) => (feature.properties?.color as `#${string}`) || colorRef.current as `#${string}`,
      editedPointWidth: (feature: StyledFeature) => ((feature.properties?.size || sizeRef.current) * 3),
      editedPointOutlineColor: '#ffffff' as `#${string}`,
      editedPointOutlineWidth: 2,
      zIndex: 50,
    };

    const draw = new TerraDraw({
      adapter,
      tracked: false,
      modes: [
        new TerraDrawSelectMode({
          keyEvents: { delete: null, deselect: 'Escape', rotate: null, scale: null },
          flags: {
            polygon: { feature: { draggable: true, coordinates: { midpoints: true, draggable: true, deletable: true } } },
            linestring: { feature: { draggable: true, coordinates: { midpoints: true, draggable: true, deletable: true } } },
            rectangle: { feature: { draggable: true, coordinates: { draggable: true } } },
            circle: { feature: { draggable: true, coordinates: { draggable: true } } },
            'freehand-linestring': { feature: { draggable: true, coordinates: { draggable: true, deletable: true } } },
            point: { feature: { draggable: true, coordinates: { draggable: true, deletable: true } } },
          },
          styles: {
            selectedPolygonColor: (feature: StyledFeature) => (feature.properties?.color as `#${string}`) || colorRef.current as `#${string}`,
            selectedPolygonFillOpacity: (feature: StyledFeature) => {
              const props = feature.properties;
              if (props && props.fill !== undefined) {
                if (!props.fill) return 0;
                return props.fillOpacity !== undefined ? props.fillOpacity : 0.4;
              }
              return fillRef.current ? (fillOpacityRef.current / 100) : 0;
            },
            selectedPolygonOutlineColor: (feature: StyledFeature) => (feature.properties?.color as `#${string}`) || colorRef.current as `#${string}`,
            selectedPolygonOutlineWidth: (feature: StyledFeature) => feature.properties?.size || sizeRef.current,
            
            selectedLineStringColor: (feature: StyledFeature) => (feature.properties?.color as `#${string}`) || colorRef.current as `#${string}`,
            selectedLineStringWidth: (feature: StyledFeature) => feature.properties?.size || sizeRef.current,
            
            selectedPointColor: (feature: StyledFeature) => (feature.properties?.color as `#${string}`) || colorRef.current as `#${string}`,
            selectedPointWidth: (feature: StyledFeature) => ((feature.properties?.size || sizeRef.current) * 3),
            
            selectionPointColor: '#5f62ec' as `#${string}`,
            selectionPointOutlineColor: '#ffffff' as `#${string}`,
            selectionPointWidth: 5,
            selectionPointOutlineWidth: 1.5,
            
            midPointColor: '#5f62ec' as `#${string}`,
            midPointOutlineColor: '#ffffff' as `#${string}`,
            midPointWidth: 4,
            midPointOutlineWidth: 1,
          }
        }),
        new TerraDrawPolygonMode({ styles: polygonStyles }),
        new TerraDrawLineStringMode({ styles: rulerStyles }),
        new TerraDrawRectangleMode({ styles: polygonStyles, drawInteraction: 'click-move-or-drag' }),
        new TerraDrawCircleMode({ styles: polygonStyles, drawInteraction: 'click-move-or-drag' }),
        new DragFriendlyFreehandLineStringMode({ styles: sketchStyles, minDistance: 2 }),
        new TerraDrawPointMode({ styles: pointStyles }),
      ],
    });

    try {
      draw.start();
    } catch {
      removeStaleTerraDrawArtifacts(map);
      try {
        draw.start();
      } catch (retryErr) {
        console.error('MapDrawTools failed to initialize TerraDraw:', retryErr);
        return;
      }
    }
    
    if (persistentFeaturesRef.current.length > 0) {
      try {
        replaceDrawFeatures(draw, persistentFeaturesRef.current);
      } catch (err) {
        console.warn("Failed to restore TerraDraw features:", err);
      }
    }
    
    drawRef.current = draw;
    const initialMode = isOpenRef.current ? activeModeRef.current : 'static';
    textModeRef.current = initialMode === 'text';
    draw.setMode(initialMode === 'text' || initialMode === 'eraser' ? 'static' : initialMode);

    const nativeLineLayerId = `${adapterPrefixId}-linestring`;
    if (map.getLayer(nativeLineLayerId)) {
      // Terra Draw remains the source of truth, but its shared LineString layer
      // must not also paint freehand features underneath the smoothed overlay.
      map.setFilter(nativeLineLayerId, [
        '!=',
        ['get', 'mode'],
        'freehand-linestring',
      ] as maplibregl.FilterSpecification);
    }

    const ensureFreehandOverlay = () => {
      if (!map.getSource(FREEHAND_OVERLAY_SOURCE_ID)) {
        map.addSource(FREEHAND_OVERLAY_SOURCE_ID, {
          type: 'geojson',
          tolerance: 0,
          data: {
            type: 'FeatureCollection',
            features: [],
          },
        });
      }

      if (!map.getLayer(FREEHAND_OVERLAY_LAYER_ID)) {
        map.addLayer({
          id: FREEHAND_OVERLAY_LAYER_ID,
          type: 'line',
          source: FREEHAND_OVERLAY_SOURCE_ID,
          layout: {
            'line-cap': 'round',
            'line-join': 'round',
          },
          paint: {
            'line-color': ['coalesce', ['get', '__drawColor'], COLORS[0]],
            'line-width': ['coalesce', ['get', '__drawWidth'], SIZES[1]],
            'line-opacity': 1,
          },
        });
      }
    };

    let overlayFrameId: number | null = null;
    let measurementTimer: ReturnType<typeof setTimeout> | null = null;

    const syncFreehandOverlay = () => {
      overlayFrameId = null;
      ensureFreehandOverlay();
      const source = map.getSource(FREEHAND_OVERLAY_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
      if (!source) return;

      const zoom = map.getZoom();
      const freehandFeatures: GeoJSON.Feature[] = [];
      for (const feature of draw.getSnapshot()) {
        if (
          feature.geometry.type !== 'LineString'
          || (feature.properties as { mode?: string } | undefined)?.mode !== 'freehand-linestring'
        ) continue;

        const coordinates = tessellateFreehandCoordinates(
          feature.geometry.coordinates as unknown as FreehandCoordinate[],
          { zoom },
        );
        // Terra Draw initially creates a duplicate two-coordinate LineString.
        // Wait for real pointer movement before sending geometry to MapLibre.
        if (coordinates.length < 2) continue;

        const props = feature.properties as { color?: string; size?: number } | undefined;
        freehandFeatures.push({
          ...feature,
          geometry: {
            ...feature.geometry,
            coordinates,
          },
          properties: {
            ...feature.properties,
            __drawColor: props?.color || colorRef.current,
            __drawWidth: props?.size || sizeRef.current,
          },
        } as GeoJSON.Feature);
      }

      source.setData({
        type: 'FeatureCollection',
        features: freehandFeatures,
      });
    };

    const scheduleFreehandOverlay = () => {
      if (overlayFrameId !== null) return;
      overlayFrameId = requestAnimationFrame(syncFreehandOverlay);
    };

    const calculateMeasurement = () => {
      measurementTimer = null;
      const snapshot = draw.getSnapshot();
      let totalArea = 0;
      let totalDistance = 0;
      let hasArea = false;
      let hasDistance = false;

      snapshot.forEach(feature => {
        const type = feature.geometry.type as string;
        if (type === 'Polygon' || type === 'MultiPolygon') {
          totalArea += turfArea(feature as unknown as GeoJSON.Feature);
          hasArea = true;
        } else if (type === 'LineString' || type === 'MultiLineString') {
          totalDistance += turfLength(feature as unknown as GeoJSON.Feature, { units: 'kilometers' });
          hasDistance = true;
        }
      });

      const isRulerActive = activeModeRef.current === 'linestring' || activeModeRef.current === 'freehand-linestring';

      if (isRulerActive && hasDistance) {
        if (totalDistance < 1) {
          setMeasurement({ value: totalDistance * 1000, unit: 'm', type: 'distance' });
        } else {
          setMeasurement({ value: totalDistance, unit: 'km', type: 'distance' });
        }
      } else if (hasArea) {
        if (totalArea > 1000000) {
          setMeasurement({ value: totalArea / 1000000, unit: 'sq km', type: 'area' });
        } else {
          setMeasurement({ value: totalArea, unit: 'sq m', type: 'area' });
        }
      } else if (hasDistance) {
        if (totalDistance < 1) {
          setMeasurement({ value: totalDistance * 1000, unit: 'm', type: 'distance' });
        } else {
          setMeasurement({ value: totalDistance, unit: 'km', type: 'distance' });
        }
      } else {
        setMeasurement(null);
      }
    };

    const scheduleMeasurement = () => {
      if (measurementTimer !== null) return;
      measurementTimer = setTimeout(calculateMeasurement, 100);
    };

    const flushMeasurement = () => {
      if (measurementTimer !== null) {
        clearTimeout(measurementTimer);
        measurementTimer = null;
      }
      calculateMeasurement();
    };

    const handleChange = () => {
      scheduleFreehandOverlay();
      scheduleMeasurement();
    };

    calculateMeasurementRef.current = flushMeasurement;
    syncFreehandOverlay();
    map.on('zoomend', scheduleFreehandOverlay);

    const handleFinish = (id: string | number, context: { action: string; mode: string }) => {
      if (suppressHistoryRef.current) return;
      // Editing geometry retains its existing style; only newly drawn features use the palette.
      if (context.action === 'draw') draw.updateFeatureProperties(id, {
        color: colorRef.current, size: sizeRef.current, fill: fillRef.current,
        fillOpacity: fillRef.current ? fillOpacityRef.current / 100 : 0,
      });
      if (!pointerGestureRef.current) commitOperation(context.action === 'draw' ? 'Draw' : 'Edit geometry');
      scheduleFreehandOverlay();
      flushMeasurement();
    };
    draw.on('finish', handleFinish);

    const canvas = map.getCanvas();
    const pointerDown = (event: PointerEvent) => {
      if (!isOpenRef.current || (event.pointerType === 'mouse' && event.button !== 0)) return;
      flushPending();
      pointerGestureRef.current = true;
      canvas.focus();
    };
    let releaseTimer: ReturnType<typeof setTimeout> | null = null;
    const pointerUp = () => {
      if (!pointerGestureRef.current) return;
      // Adapter drag-end runs after capture listeners; capture the completed document afterward.
      if (releaseTimer !== null) clearTimeout(releaseTimer);
      releaseTimer = setTimeout(() => {
        releaseTimer = null;
        pointerGestureRef.current = false;
        if (!draw.getSnapshot().some(feature => feature.properties.currentlyDrawing)) commitOperation('Draw or edit');
      }, 0);
    };
    canvas.addEventListener('pointerdown', pointerDown, true);
    window.addEventListener('pointerup', pointerUp, true);
    window.addEventListener('pointercancel', pointerUp, true);

    draw.on('change', handleChange);
    const handleSelect = (id: string | number) => {
      selectedIdRef.current = String(id);
      selectedTextRef.current = false;
      setSelectedTextId(null);
      setSelectedFeatureId(String(id));
      
      const feature = draw.getSnapshot().find(f => f.id === id);
      if (feature && feature.properties) {
        const props = feature.properties as { color?: string; size?: number; fill?: boolean; fillOpacity?: number };
        if (props.color) setActiveColor(props.color);
        if (props.size) setActiveSize(props.size);
        if (props.fill !== undefined) setActiveFill(props.fill);
        if (props.fillOpacity !== undefined) {
          setActiveFillOpacity(Math.round(props.fillOpacity * 100));
        } else if (props.fill !== undefined) {
          setActiveFillOpacity(props.fill ? 40 : 0);
        }
      }

      handleChange();
    };
    const handleDeselect = () => {
      if (!selectedTextRef.current) selectedIdRef.current = null;
      setSelectedFeatureId(null);
      handleChange();
    };
    draw.on('select', handleSelect);
    draw.on('deselect', handleDeselect);

    return () => {
      const instance = map;
      if (!instance) return;

      try {
        instance.off('zoomend', scheduleFreehandOverlay);
        draw.off('finish', handleFinish);
        draw.off('change', handleChange);
        draw.off('select', handleSelect);
        draw.off('deselect', handleDeselect);
        if (overlayFrameId !== null) cancelAnimationFrame(overlayFrameId);
        if (measurementTimer !== null) clearTimeout(measurementTimer);
        canvas.removeEventListener('pointerdown', pointerDown, true);
        window.removeEventListener('pointerup', pointerUp, true);
        window.removeEventListener('pointercancel', pointerUp, true);
        if (releaseTimer !== null) clearTimeout(releaseTimer);
        pointerGestureRef.current = false;
        if (mountedRef.current) clearSelection();
        persistentFeaturesRef.current = drawingDocument(draw.getSnapshot(), []).drawFeatures;
        calculateMeasurementRef.current = null;
        if (drawRef.current) {
          stopTerraDrawSafely(drawRef.current, instance);
          drawRef.current = null;
        }
        removeStaleTerraDrawArtifacts(instance);
      } catch (err) {
        console.warn("MapDrawTools cleanup error suppressed:", err);
      }
    };
  }, [mapReady, mapRef, commitOperation, flushPending, clearSelection]);

  // Unified Pointer-based Eraser handler for drag-to-erase (desktop and mobile)
  useEffect(() => {
    if (!isOpen || activeMode !== 'eraser' || !mapReady || !mapRef.current) return;
    const map = mapRef.current;
    const canvas = map.getCanvas();

    let isPointerErasing = false;

    const eraseAtScreenPoint = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      
      // 1. Try MapLibre queryRenderedFeatures first (pixel-perfect)
      const features = map.queryRenderedFeatures([x, y]);
      const tdFeature = features.find(f => f.layer.id.startsWith('experiment-drawing-history-') && (f.id !== undefined || (f.properties && f.properties.id)));
      if (tdFeature && drawRef.current) {
        const snapshot = drawRef.current.getSnapshot();
        const propertiesId = tdFeature.properties?.id;
        const directId = tdFeature.id;
        
        let targetId: string | null = null;
        if (propertiesId && snapshot.some(f => f.id === propertiesId.toString())) {
          targetId = propertiesId.toString();
        } else if (directId !== undefined && snapshot.some(f => f.id === directId.toString())) {
          targetId = directId.toString();
        }

        if (targetId) {
          try {
            drawRef.current.removeFeatures([targetId]);
            return;
          } catch (err) {
            console.warn('MapLibre ID lookup failed to delete, falling back to Turf:', err);
          }
        }
      }

      // 2. Resilient fallback using Turf geography check
      if (drawRef.current) {
        const lngLat = map.unproject([x, y]);
        const pointAtClick = turfPoint([lngLat.lng, lngLat.lat]);
        const snapshot = drawRef.current.getSnapshot();

        for (const feature of snapshot) {
          const type = feature.geometry.type as string;
          let hit = false;

          if (type === 'Polygon' || type === 'MultiPolygon') {
            try {
              hit = booleanPointInPolygon(pointAtClick, feature as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>);
            } catch (err) {
              console.warn('Turf polygon check error:', err);
            }
          } else if (type === 'LineString' || type === 'MultiLineString') {
            try {
              const zoom = map.getZoom();
              const metersPerPixel = 156543.03392 * Math.cos(lngLat.lat * Math.PI / 180) / Math.pow(2, zoom);
              const toleranceMeters = Math.max(5, ((feature.properties?.size as number) || 4) * metersPerPixel * 2.5);
              const distance = pointToLineDistance(pointAtClick, feature as GeoJSON.Feature<GeoJSON.LineString>, { units: 'meters' });
              hit = distance < toleranceMeters;
            } catch (err) {
              console.warn('Turf line check error:', err);
            }
          } else if (type === 'Point' || type === 'MultiPoint') {
            try {
              const geom = feature.geometry as GeoJSON.Point;
              const distance = turfDistance(pointAtClick, turfPoint(geom.coordinates), { units: 'meters' });
              const zoom = map.getZoom();
              const metersPerPixel = 156543.03392 * Math.cos(lngLat.lat * Math.PI / 180) / Math.pow(2, zoom);
              const toleranceMeters = Math.max(10, ((feature.properties?.size as number) || 4) * 3 * metersPerPixel * 2);
              hit = distance < toleranceMeters;
            } catch (err) {
              console.warn('Turf point check error:', err);
            }
          }

          if (hit && feature.id) {
            drawRef.current.removeFeatures([feature.id.toString()]);
            break;
          }
        }
      }
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return; // Left click only for mouse
      isPointerErasing = true;
      
      // Prevent map dragging during erasing gestures
      map.dragPan.disable();
      map.touchZoomRotate.disable();
      if (map.touchPitch) map.touchPitch.disable();

      eraseAtScreenPoint(e.clientX, e.clientY);
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!isPointerErasing) return;
      eraseAtScreenPoint(e.clientX, e.clientY);
    };

    const onPointerUp = () => {
      isPointerErasing = false;
    };

    canvas.addEventListener('pointerdown', onPointerDown, { capture: true, passive: false });
    canvas.addEventListener('pointermove', onPointerMove, { capture: true, passive: false });
    canvas.addEventListener('pointerup', onPointerUp, { capture: true });
    canvas.addEventListener('pointercancel', onPointerUp, { capture: true });

    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown, true);
      canvas.removeEventListener('pointermove', onPointerMove, true);
      canvas.removeEventListener('pointerup', onPointerUp, true);
      canvas.removeEventListener('pointercancel', onPointerUp, true);
    };
  }, [activeMode, isOpen, mapReady, mapRef]);

  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const map = mapRef.current;

    const handleMapClick = (e: maplibregl.MapMouseEvent) => {
      if (textModeRef.current) {
        flushPending();
        const id = newDrawingId();
        const next = [...textAnnotationsRef.current, { id,
          lngLat: [e.lngLat.lng, e.lngLat.lat] as [number, number], text: '', initialZoom: map.getZoom() }];
        textAnnotationsRef.current = next;
        setTextAnnotations(next);
        selectedIdRef.current = id;
        selectedTextRef.current = true;
        setSelectedTextId(id);
        setSelectedFeatureId(null);
        setAutoFocusTextId(id);
        // Creation and the initial typing session commit together on blur.
      }
    };

    const timer = setTimeout(() => {
      map.on('click', handleMapClick);
    }, 0);

    return () => {
      clearTimeout(timer);
      const instance = map;
      if (instance && typeof instance.off === 'function') {
        instance.off('click', handleMapClick);
      }
    };
  }, [mapReady, mapRef, flushPending]);

  useEffect(() => {
    if (!drawRef.current) return;
    const effectiveMode = isOpen ? activeMode : 'static';
    
    textModeRef.current = effectiveMode === 'text';

    drawRef.current.setMode(effectiveMode === 'text' || effectiveMode === 'eraser' ? 'static' : effectiveMode);
    const canvas = mapRef.current?.getCanvas();
    if (canvas) canvas.style.cursor = effectiveMode === 'text' || effectiveMode === 'eraser' ? 'crosshair' : '';
  }, [activeMode, isOpen, mapRef, mapReady]);

  const handleClear = () => {
    flushPending();
    applyDocument(emptyDrawingDocument(), 'Clear');
  };
  const handleDeleteSelection = useCallback(() => {
    flushPending();
    if (!selectedIdRef.current) return;
    const document = captureDocument();
    const id = selectedIdRef.current;
    document.drawFeatures = document.drawFeatures.filter(feature => feature.id !== id);
    document.textAnnotations = document.textAnnotations.filter(annotation => annotation.id !== id);
    if (restoreDocument(document)) commitOperation('Delete');
  }, [flushPending, captureDocument, restoreDocument, commitOperation]);
  const handleDuplicate = () => {
    flushPending();
    if (!selectedIdRef.current) return;
    try {
      const map = mapRef.current;
      let offset: [number, number] = [0.05, 0.05];
      if (map) {
        const center = map.project(map.getCenter());
        const shifted = map.unproject([center.x + 24, center.y + 24]);
        const original = map.getCenter();
        offset = [shifted.lng - original.lng, shifted.lat - original.lat];
      }
      const result = duplicateDrawing(captureDocument(), selectedIdRef.current, offset);
      if (result) applyDocument(result.document, 'Duplicate');
    } catch (error) { setImportError(error instanceof Error ? error.message : 'Drawing could not be duplicated.'); }
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      const ownsFocus = isOpen && Boolean(target && (wrapperRef.current?.contains(target) ||
        target === mapRef.current?.getCanvas() || target.closest('[data-drawing-annotation]')));
      const editable = Boolean(target?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])'));
      const action = drawingShortcut(event, ownsFocus, editable);
      if (!action) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (action === 'delete') handleDeleteSelection(); else handleHistory(action);
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen, mapRef, handleDeleteSelection, handleHistory]);

  const handleExport = () => {
    if (!hasFeature(userTier, 'geoJsonTransfer')) return;
    if (!drawRef.current) return;
    flushPending();
    const features = captureDocument().drawFeatures;
    
    const textFeatures = textAnnotations.filter(a => a.text.trim().length > 0).map(a => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: a.lngLat },
      properties: { isText: true, text: a.text, initialZoom: a.initialZoom }
    }));

    const geojson = {
      type: 'FeatureCollection',
      features: [...features, ...textFeatures]
    };

    // Construct a highly descriptive and useful filename containing a timestamp and map view state
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const timestamp = `${year}${month}${day}-${hours}${minutes}${seconds}`;

    let viewSuffix = '';
    if (mapRef.current) {
      try {
        const center = mapRef.current.getCenter();
        const zoom = mapRef.current.getZoom();
        const lat = center.lat.toFixed(4);
        const lng = center.lng.toFixed(4);
        const z = zoom.toFixed(1);
        viewSuffix = `_z${z}_lat${lat}_lng${lng}`;
      } catch (err) {
        console.warn('Failed to extract map coordinates for export filename:', err);
      }
    }

    const fileName = `seraphim_draw_${timestamp}${viewSuffix}.geojson`;

    const blob = new Blob([JSON.stringify(geojson)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url); // Clean up the object URL to prevent memory leaks
  };

  const importValue = (value: unknown) => {
    // Validate and build the complete candidate before touching either shape or text state.
    const candidate = appendDrawingImport(captureDocument(), value, mapRef.current?.getZoom() ?? 10);
    if (!restoreDocument(candidate)) return false;
    commitOperation('Import');
    return true;
  };
  const handleImport = () => {
    if (!hasFeature(userTier, 'geoJsonTransfer')) return;
    flushPending();
    setImportError(null);
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.geojson,.json,application/json';
    input.onchange = (event) => {
      if (!mountedRef.current) return;
      const file = (event.target as HTMLInputElement).files?.[0];
      if (!file) return;
      if (file.size > MAX_IMPORT_BYTES) { setImportError('Choose a GeoJSON file smaller than 2 MB.'); return; }
      readerRef.current?.abort();
      const reader = new FileReader();
      readerRef.current = reader;
      reader.onerror = () => { if (mountedRef.current) setImportError('The file could not be read. Please try again.'); };
      reader.onload = () => {
        if (!mountedRef.current) return;
        try { importValue(JSON.parse(String(reader.result))); }
        catch (error) { setImportError(error instanceof Error && !(error instanceof SyntaxError)
          ? error.message : 'The file is not valid GeoJSON.'); }
      };
      reader.readAsText(file);
    };
    input.click();
  };
  const importLegacy = () => {
    flushPending();
    const legacy = readDrawStorage(null, true);
    if (!legacy.document) { setStorageError(legacy.error); return; }
    try {
      const imported = importValue({ type: 'FeatureCollection', features: [...legacy.document.drawFeatures,
        ...legacy.document.textAnnotations.map(annotation => ({ type: 'Feature',
          geometry: { type: 'Point', coordinates: annotation.lngLat },
          properties: { isText: true, text: annotation.text, initialZoom: annotation.initialZoom } }))] });
      if (imported) setLegacyAvailable(false);
    } catch (error) { setImportError(error instanceof Error ? error.message : 'Device drawings could not be imported.'); }
  };
  const selectText = (id: string) => {
    if (selectedIdRef.current !== id) flushPending();
    // Deselecting a shape only changes presentation.
    if (drawRef.current?.getMode() === 'select' && selectedFeatureId) drawRef.current.deselectFeature(selectedFeatureId);
    selectedIdRef.current = id;
    selectedTextRef.current = true;
    setSelectedTextId(id);
    setSelectedFeatureId(null);
  };
  const updateTextAnnotation = (id: string, text: string) => {
    if (textAnnotationsRef.current.find(annotation => annotation.id === id)?.text === text) return;
    if (history.discardRedo()) refreshHistory(version => version + 1);
    const next = textAnnotationsRef.current.map(annotation => annotation.id === id ? { ...annotation, text } : annotation);
    textAnnotationsRef.current = next;
    setTextAnnotations(next);
    saveDocument(captureDocument());
  };
  const finishTextEdit = (id: string) => {
    const annotation = textAnnotationsRef.current.find(annotation => annotation.id === id);
    if (annotation?.text.trim() === '') {
      textAnnotationsRef.current = textAnnotationsRef.current.filter(annotation => annotation.id !== id);
      setTextAnnotations(textAnnotationsRef.current);
      if (selectedIdRef.current === id) clearSelection();
    }
    commitOperation('Text');
    saveDocument(captureDocument());
  };
  const removeTextAnnotation = (id: string) => {
    flushPending();
    textAnnotationsRef.current = textAnnotationsRef.current.filter(annotation => annotation.id !== id);
    setTextAnnotations(textAnnotationsRef.current);
    if (selectedIdRef.current === id) clearSelection();
    commitOperation('Delete text');
  };
  const updateTextAnnotationPosition = (id: string, lngLat: [number, number]) => {
    textAnnotationsRef.current = textAnnotationsRef.current.map(annotation => annotation.id === id ? { ...annotation, lngLat } : annotation);
    setTextAnnotations(textAnnotationsRef.current);
    commitOperation('Move text');
  };

  const handleDrawSizeInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const nextValue = Number.parseInt(event.target.value, 10);
    if (Number.isNaN(nextValue)) return;
    changeSize(Math.max(MIN_DRAW_SIZE, Math.min(MAX_DRAW_SIZE, nextValue)));
  };

  const handleOpacityInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const nextValue = Number.parseInt(event.target.value, 10);
    if (Number.isNaN(nextValue)) return;
    changeOpacity(Math.max(0, Math.min(100, nextValue)));
  };

  const handleCustomColorChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const nextColor = event.target.value;
    setHasPickedCustomColor(true);
    setCustomPickerColor(nextColor);
    changeColor(nextColor);
  };

  const isCustomColorActive = !COLORS.some((color) => color.toLowerCase() === activeColor.toLowerCase());

  return (
    <>
      {isOpen && (
        <div 
          ref={wrapperRef}
          data-drawing-tools
          onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) flushPending(); }}
          className={styles.drawToolsWrapper}
          style={position ? {
            top: `${position.y}px`,
            left: `${position.x}px`,
            right: 'auto',
            transform: 'none'
          } : undefined}
        >
          <div 
            className={`${styles.drawToolsPanel} ${isCollapsed ? styles.collapsed : ''}`}
            onMouseDown={handleMouseDown}
          >
            {/* Header / Collapse Toggle */}
            <div className={styles.panelHeader}>
              <div className={styles.panelTitle}>
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 19l7-7 3 3-7 7-3-3z"></path>
                  <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"></path>
                  <path d="M2 2l7.58 7.58"></path>
                </svg>
                <span className={styles.titleText}>
                  {isCollapsed && measurement ? (
                    <span className={styles.collapsedMeasurement}>
                      {measurement.type === 'area' ? 'Area' : 'Dist'}: {measurement.value.toFixed(2)} {measurement.unit}
                    </span>
                  ) : (
                    "Draw & Measure"
                  )}
                </span>
              </div>
              <div className={styles.panelHeaderActions}>
                <button 
                  className={styles.headerBtn} 
                  onClick={() => setIsCollapsed(!isCollapsed)} 
                  title={isCollapsed ? "Expand panel" : "Collapse panel"}
                  aria-label={isCollapsed ? "Expand panel" : "Collapse panel"}
                >
                  {isCollapsed ? (
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6"/></svg>
                  ) : (
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 15l-6-6-6 6"/></svg>
                  )}
                </button>
                {onClose && (
                  <button 
                    className={`${styles.headerBtn} ${styles.closeBtn}`} 
                    onClick={onClose} 
                    title="Close drawing tools"
                    aria-label="Close drawing tools"
                  >
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
                  </button>
                )}
              </div>
            </div>

            <div className={styles.historyActions} role="group" aria-label="Drawing history and selection">
              <DrawingActionButton className={styles.actionBtn} disabled={!mapReady || !history.canUndo} onAction={() => handleHistory('undo')}
                title={history.undoLabel ? `Undo ${history.undoLabel} (Ctrl/Cmd Z)` : 'Undo (Ctrl/Cmd Z)'}>Undo</DrawingActionButton>
              <DrawingActionButton className={styles.actionBtn} disabled={!mapReady || !history.canRedo} onAction={() => handleHistory('redo')}
                title="Redo (Ctrl/Cmd Shift Z or Ctrl/Cmd Y)">Redo</DrawingActionButton>
              <DrawingActionButton className={styles.actionBtn} disabled={!mapReady || !(selectedFeatureId || selectedTextId)} onAction={handleDuplicate}
                title="Duplicate selected drawing or text">Duplicate</DrawingActionButton>
              <DrawingActionButton className={`${styles.actionBtn} ${styles.danger}`} disabled={!mapReady || !(selectedFeatureId || selectedTextId)}
                onAction={handleDeleteSelection} title="Delete selected drawing or text">Delete</DrawingActionButton>
            </div>
            {!isCollapsed && (
              <div className={styles.panelContent}>
                {importError && <p role="alert">{importError}</p>}
                {storageError && <p role="alert">{storageError}</p>}
                {legacyAvailable && <div className={styles.storageNotice}>
                  <p>Device drawings from an earlier version are available. Import a copy into this account.</p>
                  <button className={styles.actionBtn} onClick={importLegacy} disabled={!mapReady} title="Import a copy of legacy device drawings into this account">Import device drawings</button>
                </div>}
                <p className={styles.historyHint}>Undo keeps up to 50 edits during this session. Select a drawing to duplicate or delete it.</p>
                {/* Section 1: Measurement */}
                <div className={styles.section}>
                  <div className={styles.sectionTitle}>Measure</div>
                  <div className={styles.measurementBox}>
                    <div className={styles.measurementLabel}>{measurement?.type || 'Metrics'}</div>
                    {measurement ? `${measurement.value.toFixed(2)} ${measurement.unit}` : '0.00'}
                  </div>
                </div>

                {/* Section 2: Draw */}
                <div className={styles.section}>
                  <div className={styles.sectionTitle}>Draw</div>
                  <div className={styles.grid}>
                    <button className={`${styles.toolBtn} ${activeMode === 'select' ? styles.active : ''}`} onClick={() => { flushPending(); setActiveMode('select'); }} title="Select and edit an existing drawing">
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/><path d="M13 13l6 6"/></svg>
                      Select
                    </button>
                    <button className={`${styles.toolBtn} ${activeMode === 'polygon' ? styles.active : ''}`} onClick={() => { flushPending(); setActiveMode('polygon'); }} title="Draw a polygon and measure its area">
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 14l5-9 9 3 4 10-10 3-8-7z"/></svg>
                      Area
                    </button>
                    <button className={`${styles.toolBtn} ${activeMode === 'linestring' ? styles.active : ''}`} onClick={() => { flushPending(); setActiveMode('linestring'); }} title="Draw a line and measure its distance">
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 21L21 3"/></svg>
                      Ruler
                    </button>
                    <button className={`${styles.toolBtn} ${activeMode === 'rectangle' ? styles.active : ''}`} onClick={() => { flushPending(); setActiveMode('rectangle'); }} title="Draw a rectangle and measure its area">
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/></svg>
                      Rect
                    </button>
                    <button className={`${styles.toolBtn} ${activeMode === 'circle' ? styles.active : ''}`} onClick={() => { flushPending(); setActiveMode('circle'); }} title="Draw a circle and measure its area">
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/></svg>
                      Circle
                    </button>
                    <button className={`${styles.toolBtn} ${activeMode === 'point' ? styles.active : ''}`} onClick={() => { flushPending(); setActiveMode('point'); }} title="Place a point marker on the map">
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                      Pin
                    </button>
                    <button className={`${styles.toolBtn} ${activeMode === 'freehand-linestring' ? styles.active : ''}`} onClick={() => { flushPending(); setActiveMode('freehand-linestring'); }} title="Draw a freehand line on the map">
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.58 7.58"/></svg>
                      Sketch
                    </button>
                    <button className={`${styles.toolBtn} ${activeMode === 'text' ? styles.active : ''}`} onClick={() => { flushPending(); setActiveMode('text'); }} title="Place a text annotation on the map">
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 7V4h16v3M9 20h6M12 4v16"/></svg>
                      Text
                    </button>
                    <button className={`${styles.toolBtn} ${activeMode === 'eraser' ? styles.active : ''}`} onClick={() => { flushPending(); setActiveMode('eraser'); }} title="Remove a drawing from the map">
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21" />
                        <path d="M22 21H7" />
                        <path d="m5 11 9 9" />
                      </svg>
                      Eraser
                    </button>
                  </div>
                </div>

                {/* Section 3: Color */}
                <div className={styles.section}>
                  <div className={styles.sectionTitle}>Color</div>
                  <div className={styles.colors}>
                    {COLORS.map(c => (
                      <button
                        key={c}
                        className={`${styles.colorBtn} ${activeColor.toLowerCase() === c.toLowerCase() ? styles.active : ''}`}
                        style={{ backgroundColor: c }}
                        onClick={() => { flushPending(); changeColor(c); }}
                        title={`Use ${c} as the draw color`}
                        aria-label={`Use ${c} as the draw color`}
                      />
                    ))}
                    <label
                      className={`${styles.colorPickerDot} ${isCustomColorActive ? styles.active : ''} ${!hasPickedCustomColor ? styles.cycling : ''}`}
                      style={hasPickedCustomColor ? { backgroundColor: customPickerColor } : undefined}
                      title="Custom color"
                    >
                      <input
                        className={styles.colorPickerInput}
                        type="color"
                        value={activeColor}
                        onChange={handleCustomColorChange}
                        aria-label="Pick custom draw color"
                        title="Pick a custom draw color"
                      />
                      <span className={styles.colorPickerGlyph}>+</span>
                    </label>
                  </div>
                </div>

                 {/* Section 4: Size & Fill */}
                <div className={styles.section}>
                  <div className={styles.sectionTitle}>Style</div>
                  <div className={styles.styleRow}>
                    <span className={styles.styleRowLabel}>Brush</span>
                    <div className={styles.presetSizes}>
                      {SIZES.map((sizeValue) => (
                        <button
                          key={sizeValue}
                          className={`${styles.sizeBtn} ${styles.sizeSymbolBtn} ${activeSize === sizeValue ? styles.active : ''}`}
                          onClick={() => { flushPending(); changeSize(sizeValue); }}
                          title={`Set draw size ${sizeValue}`}
                        >
                          <div className={styles.sizeIndicator} style={{ width: sizeValue * 1.5, height: sizeValue * 1.5 }} />
                        </button>
                      ))}
                    </div>
                    <div className={`${styles.sizeInputWrap} ${styles.rightAlign}`}>
                      <input
                        className={styles.sizeInput}
                        type="number"
                        min={MIN_DRAW_SIZE}
                        max={MAX_DRAW_SIZE}
                        step={1}
                        value={activeSize}
                        onChange={handleDrawSizeInputChange}
                        title="Custom draw size"
                      />
                      <span className={styles.unitLabel}>px</span>
                    </div>
                  </div>
                  <div className={styles.styleRow}>
                    <span className={styles.styleRowLabel}>Fill</span>
                    <button
                      className={`${styles.sizeBtn} ${styles.fillBtn} ${activeFill ? styles.active : ''}`}
                      onClick={() => { flushPending(); changeFill(!activeFill); }}
                      title={`${activeFill ? 'Disable' : 'Enable'} shape fill`}
                    >
                      <svg viewBox="0 0 24 24" width="16" height="16" fill={activeFill ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
                      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                      </svg>
                    </button>
                    <div className={`${styles.sizeInputWrap} ${styles.rightAlign}`}>
                      <input
                        className={styles.opacityInput}
                        type="number"
                        min={0}
                        max={100}
                        step={5}
                        value={activeFillOpacity}
                        onChange={handleOpacityInputChange}
                        title="Custom fill opacity (%)"
                        disabled={!activeFill}
                      />
                      <span className={styles.unitLabel}>%</span>
                    </div>
                  </div>
                </div>

                {/* Section 5: Actions */}
                <div className={styles.actions}>
                  <button className={`${styles.actionBtn} ${styles.danger}`} onClick={handleClear} disabled={!mapReady || !(history.hasDrawings || textAnnotations.length)} title="Remove all drawings and annotations from the map">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: '4px', verticalAlign: 'middle' }}><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6"/></svg>
                    Clear
                  </button>
                  <GatedButton className={styles.actionBtn} onClick={handleImport} allowed={hasFeature(userTier, 'geoJsonTransfer')} requiredTier="analyst" featureName="GeoJSON import" featureDescription="Bring geographic boundaries and annotations from a GeoJSON file into your map." title="Import drawings from a GeoJSON file">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: '4px', verticalAlign: 'middle' }}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
                    Import
                  </GatedButton>
                  <GatedButton className={styles.actionBtn} onClick={handleExport} allowed={hasFeature(userTier, 'geoJsonTransfer')} requiredTier="analyst" featureName="GeoJSON export" featureDescription="Save your map drawings as GeoJSON to share or continue your work in other mapping tools." title="Export map drawings as a GeoJSON file">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: '4px', verticalAlign: 'middle' }}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/></svg>
                    Export
                  </GatedButton>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Render Text Annotations */}
      {textAnnotations.map(annotation => (
        <TextMarker 
          key={annotation.id} 
          mapRef={mapRef}
          mapReady={mapReady}
          annotation={annotation}
          activeMode={isOpen ? activeMode : 'static'}
          selected={selectedTextId === annotation.id}
          autoFocus={autoFocusTextId === annotation.id}
          onSelect={() => selectText(annotation.id)}
          onEditEnd={() => finishTextEdit(annotation.id)}
          onUpdate={(text) => updateTextAnnotation(annotation.id, text)}
          onRemove={() => removeTextAnnotation(annotation.id)}
          onDragEnd={(lngLat) => updateTextAnnotationPosition(annotation.id, lngLat)}
        />
      ))}
    </>
  );
}
