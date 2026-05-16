import React, { useEffect, useMemo, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import { createPortal } from 'react-dom';
import {
  TerraDraw,
  TerraDrawSelectMode,
  TerraDrawPolygonMode,
  TerraDrawLineStringMode,
  TerraDrawRectangleMode,
  TerraDrawCircleMode,
  TerraDrawFreehandLineStringMode,
  TerraDrawPointMode,
} from 'terra-draw';
import { TerraDrawMapLibreGLAdapter } from 'terra-draw-maplibre-gl-adapter';
import * as turf from '@turf/turf';
import styles from './MapDrawTools.module.css';

interface MapDrawToolsProps {
  mapRef: React.MutableRefObject<maplibregl.Map | null>;
  mapReady: boolean;
  isOpen: boolean;
  userTier?: string;
}

const COLORS = ['#6366f1', '#ef4444', '#10b981', '#f59e0b', '#3b82f6', '#ffffff', '#000000'];
const SIZES = [2, 4, 8];
const MIN_DRAW_SIZE = 1;
const MAX_DRAW_SIZE = 50;
const FREEHAND_OVERLAY_SOURCE_ID = 'td-freehand-lines-overlay-source';
const FREEHAND_OVERLAY_LAYER_ID = 'td-freehand-lines-overlay-layer';
const DRAW_STORAGE_KEY = 'seraphim-map-draw-tools-v1';

interface TextAnnotation {
  id: string;
  lngLat: [number, number];
  text: string;
  initialZoom: number;
}

interface PersistedDrawState {
  version: number;
  drawFeatures: unknown[];
  textAnnotations: TextAnnotation[];
}

const isValidTextAnnotation = (annotation: unknown): annotation is TextAnnotation => {
  if (!annotation || typeof annotation !== 'object') return false;
  const candidate = annotation as Partial<TextAnnotation>;
  return typeof candidate.id === 'string'
    && Array.isArray(candidate.lngLat)
    && candidate.lngLat.length === 2
    && typeof candidate.lngLat[0] === 'number'
    && typeof candidate.lngLat[1] === 'number'
    && typeof candidate.text === 'string'
    && typeof candidate.initialZoom === 'number';
};

const readPersistedDrawState = (): PersistedDrawState | null => {
  if (typeof window === 'undefined') return null;

  try {
    const raw = window.localStorage.getItem(DRAW_STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as {
      version?: number;
      drawFeatures?: unknown;
      textAnnotations?: unknown;
    };

    if (!Array.isArray(parsed.drawFeatures) || !Array.isArray(parsed.textAnnotations)) {
      console.warn('Ignoring invalid persisted map annotations payload.');
      return null;
    }

    return {
      version: typeof parsed.version === 'number' ? parsed.version : 1,
      drawFeatures: parsed.drawFeatures,
      textAnnotations: parsed.textAnnotations.filter(isValidTextAnnotation),
    };
  } catch (err) {
    console.warn('Failed to load persisted map annotations:', err);
    return null;
  }
};

const persistDrawState = (drawFeatures: unknown[], annotations: TextAnnotation[]) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(DRAW_STORAGE_KEY, JSON.stringify({
      version: 1,
      drawFeatures,
      textAnnotations: annotations,
    }));
  } catch (err) {
    console.warn('Failed to persist map annotations:', err);
  }
};

const clearPersistedDrawState = () => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(DRAW_STORAGE_KEY);
  } catch (err) {
    console.warn('Failed to clear persisted map annotations:', err);
  }
};

type FreehandPointerEvent = Parameters<TerraDrawFreehandLineStringMode['onMouseMove']>[0];

class DragFriendlyFreehandLineStringMode extends TerraDrawFreehandLineStringMode {
  private isDragSketchActive = false;

  public onDragStart(event?: FreehandPointerEvent, setMapDraggability?: (enabled: boolean) => void, userTier?: string, isOpen?: boolean): void {
    if (userTier === 'guest' || !isOpen || !event) return;
    this.isDragSketchActive = true;
    setMapDraggability?.(false);
    this.onClick({ ...event, button: 'left', isContextMenu: false });
  }

  public onDrag(event?: FreehandPointerEvent): void {
    if (!event || !this.isDragSketchActive) return;
    this.onMouseMove(event);
  }

  public onDragEnd(event?: FreehandPointerEvent, setMapDraggability?: (enabled: boolean) => void): void {
    if (event && this.isDragSketchActive) {
      this.onMouseMove(event);
      this.onClick({ ...event, button: 'left', isContextMenu: false });
    }
    this.isDragSketchActive = false;
    setMapDraggability?.(true);
  }

  public cleanUp(): void {
    this.isDragSketchActive = false;
    super.cleanUp();
  }
}

export default function MapDrawTools({ mapRef, mapReady, isOpen, userTier = 'guest' }: MapDrawToolsProps) {
  const drawRef = useRef<TerraDraw | null>(null);
  const [activeMode, setActiveMode] = useState<string>('static');
  const [activeColor, setActiveColor] = useState<string>(COLORS[0]);
  const [activeSize, setActiveSize] = useState<number>(SIZES[1]);
  const [activeFill, setActiveFill] = useState<boolean>(true);
  const [hasPickedCustomColor, setHasPickedCustomColor] = useState(false);
  const [customPickerColor, setCustomPickerColor] = useState<string>('#8b5cf6');
  const colorRef = useRef(activeColor);
  const sizeRef = useRef(activeSize);
  const fillRef = useRef(activeFill);
  
  useEffect(() => { colorRef.current = activeColor; }, [activeColor]);
  useEffect(() => { sizeRef.current = activeSize; }, [activeSize]);
  useEffect(() => { fillRef.current = activeFill; }, [activeFill]);

  const [measurement, setMeasurement] = useState<{ value: number; unit: string; type: 'area' | 'distance' } | null>(null);

  const initialPersistedState = useMemo(() => {
    if (userTier === 'guest') return null;
    return readPersistedDrawState();
  }, [userTier]);

  const [textAnnotations, setTextAnnotations] = useState<TextAnnotation[]>([]);

  useEffect(() => {
    if (initialPersistedState?.textAnnotations) {
      requestAnimationFrame(() => {
        setTextAnnotations(initialPersistedState.textAnnotations);
      });
    } else {
      requestAnimationFrame(() => {
        setTextAnnotations([]);
      });
    }
  }, [initialPersistedState]);

  const textModeRef = useRef(false);
  type SnapshotFeatures = ReturnType<InstanceType<typeof TerraDraw>['getSnapshot']>;
  const persistentFeaturesRef = useRef<SnapshotFeatures>(
    (userTier !== 'guest' ? initialPersistedState?.drawFeatures as SnapshotFeatures : []) ?? [],
  );
  const textAnnotationsRef = useRef<TextAnnotation[]>(textAnnotations);

  const activeModeRef = useRef(activeMode);
  const calculateMeasurementRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    textAnnotationsRef.current = textAnnotations;
  }, [textAnnotations]);

  useEffect(() => { 
    activeModeRef.current = activeMode; 
    if (calculateMeasurementRef.current) {
      calculateMeasurementRef.current();
    }

    if (mapRef.current) {
      if (activeMode === 'freehand-linestring') {
        mapRef.current.dragPan.disable();
      } else {
        mapRef.current.dragPan.enable();
      }
    }
  }, [activeMode, mapRef]);
  
  useEffect(() => {
    if (userTier === 'guest') {
      clearPersistedDrawState();
      persistentFeaturesRef.current = [];
      textAnnotationsRef.current = [];
      
      requestAnimationFrame(() => {
        setTextAnnotations([]);
        setMeasurement(null);
        if (drawRef.current) {
          drawRef.current.clear();
        }
      });
    }
  }, [userTier]);

  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const map = mapRef.current;

    const adapter = new TerraDrawMapLibreGLAdapter({ map });

    type StyledFeature = { properties?: { color?: string; size?: number; fill?: boolean } };

    const polygonStyles = {
      fillColor: (feature: StyledFeature) => (feature.properties?.color as `#${string}`) || colorRef.current as `#${string}`,
      fillOpacity: (feature: StyledFeature) => {
        if (feature.properties && feature.properties.fill !== undefined) {
          return feature.properties.fill ? 0.4 : 0;
        }
        return fillRef.current ? 0.4 : 0;
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
      modes: [
        new TerraDrawSelectMode({
          flags: {
            polygon: { feature: { draggable: true, coordinates: { midpoints: true, draggable: true, deletable: true } } },
            linestring: { feature: { draggable: true, coordinates: { midpoints: true, draggable: true, deletable: true } } },
            rectangle: { feature: { draggable: true, coordinates: { draggable: true } } },
            circle: { feature: { draggable: true, coordinates: { draggable: true } } },
            'freehand-linestring': { feature: { draggable: true, coordinates: { draggable: true, deletable: true } } },
            point: { feature: { draggable: true, coordinates: { draggable: true, deletable: true } } },
          }
        }),
        new TerraDrawPolygonMode({ styles: polygonStyles }),
        new TerraDrawLineStringMode({ styles: rulerStyles }),
        new TerraDrawRectangleMode({ styles: polygonStyles }),
        new TerraDrawCircleMode({ styles: polygonStyles }),
        new DragFriendlyFreehandLineStringMode({ styles: sketchStyles, minDistance: 2 }),
        new TerraDrawPointMode({ styles: pointStyles }),
      ],
    });

    draw.start();
    
    if (persistentFeaturesRef.current.length > 0) {
      try {
        draw.addFeatures(persistentFeaturesRef.current);
      } catch (err) {
        console.warn("Failed to restore TerraDraw features:", err);
      }
    }
    
    drawRef.current = draw;

    const ensureFreehandOverlay = () => {
      if (!map.getSource(FREEHAND_OVERLAY_SOURCE_ID)) {
        map.addSource(FREEHAND_OVERLAY_SOURCE_ID, {
          type: 'geojson',
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

    const syncFreehandOverlay = () => {
      ensureFreehandOverlay();
      const source = map.getSource(FREEHAND_OVERLAY_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
      if (!source) return;

      const freehandFeatures = draw.getSnapshot()
        .filter((feature) => {
          return feature.geometry.type === 'LineString'
            && (feature.properties as { mode?: string } | undefined)?.mode === 'freehand-linestring';
        })
        .map((feature) => {
          const props = feature.properties as { color?: string; size?: number } | undefined;
          return {
            ...feature,
            properties: {
              ...feature.properties,
              __drawColor: props?.color || colorRef.current,
              __drawWidth: props?.size || sizeRef.current,
            },
          };
        });

      source.setData({
        type: 'FeatureCollection',
        features: freehandFeatures as GeoJSON.Feature[],
      });
    };

    syncFreehandOverlay();

    const handleChange = () => {
      if (drawRef.current) {
        persistentFeaturesRef.current = drawRef.current.getSnapshot();
      }
      if (userTier !== 'guest') {
        persistDrawState(persistentFeaturesRef.current, textAnnotationsRef.current);
      }
      syncFreehandOverlay();
      calculateMeasurement();
    };

    const calculateMeasurement = () => {
      const snapshot = draw.getSnapshot();
      let totalArea = 0;
      let totalDistance = 0;
      let hasArea = false;
      let hasDistance = false;

      snapshot.forEach(feature => {
        const type = feature.geometry.type as string;
        if (type === 'Polygon' || type === 'MultiPolygon') {
          totalArea += turf.area(feature as unknown as GeoJSON.Feature);
          hasArea = true;
        } else if (type === 'LineString' || type === 'MultiLineString') {
          totalDistance += turf.length(feature as unknown as GeoJSON.Feature, { units: 'kilometers' });
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

    calculateMeasurementRef.current = calculateMeasurement;

    draw.on('finish', (id) => {
      draw.updateFeatureProperties(id as string, { 
        color: colorRef.current, 
        size: sizeRef.current,
        fill: fillRef.current 
      });
      if (drawRef.current) {
        persistentFeaturesRef.current = drawRef.current.getSnapshot();
        if (userTier !== 'guest') {
          persistDrawState(persistentFeaturesRef.current, textAnnotationsRef.current);
        }
      }
      syncFreehandOverlay();
    });

    draw.on('change', handleChange);
    draw.on('select', () => {
      if (userTier === 'guest') return;
      handleChange();
    });
    draw.on('deselect', () => {
      if (userTier === 'guest') return;
      handleChange();
    });

    return () => {
      if (map.getLayer(FREEHAND_OVERLAY_LAYER_ID)) {
        map.removeLayer(FREEHAND_OVERLAY_LAYER_ID);
      }
      if (map.getSource(FREEHAND_OVERLAY_SOURCE_ID)) {
        map.removeSource(FREEHAND_OVERLAY_SOURCE_ID);
      }
      if (drawRef.current) {
        try {
          if (map && map.getStyle()) {
            drawRef.current.stop();
          }
        } catch (err) {
          console.warn("TerraDraw stop error suppressed:", err);
        }
        drawRef.current = null;
      }
    };
  }, [mapReady, mapRef, userTier]);

  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const map = mapRef.current;

    const handleMapClick = (e: maplibregl.MapMouseEvent) => {
      if (textModeRef.current) {
        const id = Math.random().toString(36).substr(2, 9);
        const initialZoom = map.getZoom();
        const lngLat: [number, number] = [e.lngLat.lng, e.lngLat.lat];
        setTextAnnotations(prev => {
          const next = [...prev, { id, lngLat, text: '', initialZoom }];
          textAnnotationsRef.current = next;
          if (userTier !== 'guest') {
            persistDrawState(persistentFeaturesRef.current, next);
          }
          return next;
        });
      }
    };

    const timer = setTimeout(() => {
      map.on('click', handleMapClick);
    }, 0);

    return () => {
      clearTimeout(timer);
      map.off('click', handleMapClick);
    };
  }, [mapReady, mapRef, userTier]);

  useEffect(() => {
    if (!drawRef.current) return;
    const effectiveMode = isOpen ? activeMode : 'static';
    
    textModeRef.current = effectiveMode === 'text';

    if (effectiveMode === 'text') {
      drawRef.current.setMode('static');
      if (mapRef.current) mapRef.current.getCanvas().style.cursor = 'crosshair';
    } else {
      if (mapRef.current) mapRef.current.getCanvas().style.cursor = '';
      drawRef.current.setMode(effectiveMode);
    }
  }, [activeMode, isOpen, mapRef]);

  const handleClear = () => {
    if (drawRef.current) {
      drawRef.current.clear();
      setMeasurement(null);
    }
    persistentFeaturesRef.current = [];
    textAnnotationsRef.current = [];
    setTextAnnotations([]);
    clearPersistedDrawState();
  };

  const handleExport = () => {
    if (!drawRef.current) return;
    const features = drawRef.current.getSnapshot();
    
    const textFeatures = textAnnotations.filter(a => a.text.trim().length > 0).map(a => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: a.lngLat },
      properties: { isText: true, text: a.text, initialZoom: a.initialZoom }
    }));

    const geojson = {
      type: 'FeatureCollection',
      features: [...features, ...textFeatures]
    };

    const blob = new Blob([JSON.stringify(geojson)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'map-annotations.geojson';
    a.click();
  };

  const handleImport = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.geojson,application/json';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const geojson = JSON.parse(event.target?.result as string);
          if (geojson.type === 'FeatureCollection' && drawRef.current) {
            const drawFeatures = geojson.features.filter((f: { properties?: { isText?: boolean } }) => !f.properties?.isText);
            const importedText = geojson.features
              .filter((f: { properties?: { isText?: boolean } }) => f.properties?.isText)
              .map((f: { geometry: { coordinates: [number, number] }, properties: { text: string, initialZoom?: number } }) => ({
                id: Math.random().toString(36).substr(2, 9),
                lngLat: f.geometry.coordinates,
                text: f.properties.text,
                initialZoom: f.properties.initialZoom || (mapRef.current ? mapRef.current.getZoom() : 10)
              }));
            
            drawRef.current.addFeatures(drawFeatures as SnapshotFeatures);
            persistentFeaturesRef.current = drawRef.current.getSnapshot();
            setTextAnnotations(prev => {
              const next = [...prev, ...importedText];
              textAnnotationsRef.current = next;
              if (userTier !== 'guest') {
                persistDrawState(persistentFeaturesRef.current, next);
              }
              return next;
            });
          }
        } catch (err) {
          console.error("Failed to import GeoJSON:", err);
        }
      };
      reader.readAsText(file);
    };
    input.click();
  };

  const updateTextAnnotation = (id: string, text: string) => {
    setTextAnnotations(prev => {
      const next = prev.map(a => a.id === id ? { ...a, text } : a);
      textAnnotationsRef.current = next;
      if (userTier !== 'guest') {
        persistDrawState(persistentFeaturesRef.current, next);
      }
      return next;
    });
  };

  const removeTextAnnotation = (id: string) => {
    setTextAnnotations(prev => {
      const next = prev.filter(a => a.id !== id);
      textAnnotationsRef.current = next;
      if (userTier !== 'guest') {
        persistDrawState(persistentFeaturesRef.current, next);
      }
      return next;
    });
  };

  const updateTextAnnotationPosition = (id: string, lngLat: [number, number]) => {
    setTextAnnotations(prev => {
      const next = prev.map(a => a.id === id ? { ...a, lngLat } : a);
      textAnnotationsRef.current = next;
      if (userTier !== 'guest') {
        persistDrawState(persistentFeaturesRef.current, next);
      }
      return next;
    });
  };

  const handleDrawSizeInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const nextValue = Number.parseInt(event.target.value, 10);
    if (Number.isNaN(nextValue)) return;
    setActiveSize(Math.max(MIN_DRAW_SIZE, Math.min(MAX_DRAW_SIZE, nextValue)));
  };

  const handleCustomColorChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const nextColor = event.target.value;
    setHasPickedCustomColor(true);
    setCustomPickerColor(nextColor);
    setActiveColor(nextColor);
  };

  const isCustomColorActive = !COLORS.some((color) => color.toLowerCase() === activeColor.toLowerCase());

  return (
    <>
      {isOpen && (
        <div className={styles.drawToolsWrapper}>
          <div className={styles.drawToolsPanel}>
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
                <button className={`${styles.toolBtn} ${activeMode === 'select' ? styles.active : ''}`} onClick={() => setActiveMode('select')}>
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/><path d="M13 13l6 6"/></svg>
                  Select
                </button>
                <button className={`${styles.toolBtn} ${activeMode === 'polygon' ? styles.active : ''}`} onClick={() => setActiveMode('polygon')}>
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 14l5-9 9 3 4 10-10 3-8-7z"/></svg>
                  Area
                </button>
                <button className={`${styles.toolBtn} ${activeMode === 'linestring' ? styles.active : ''}`} onClick={() => setActiveMode('linestring')}>
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 21L21 3"/></svg>
                  Ruler
                </button>
                <button className={`${styles.toolBtn} ${activeMode === 'rectangle' ? styles.active : ''}`} onClick={() => setActiveMode('rectangle')}>
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/></svg>
                  Rect
                </button>
                <button className={`${styles.toolBtn} ${activeMode === 'circle' ? styles.active : ''}`} onClick={() => setActiveMode('circle')}>
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/></svg>
                  Circle
                </button>
                <button className={`${styles.toolBtn} ${activeMode === 'point' ? styles.active : ''}`} onClick={() => setActiveMode('point')}>
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                  Pin
                </button>
                <button className={`${styles.toolBtn} ${activeMode === 'freehand-linestring' ? styles.active : ''}`} onClick={() => setActiveMode('freehand-linestring')}>
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.58 7.58"/></svg>
                  Sketch
                </button>
                <button className={`${styles.toolBtn} ${activeMode === 'text' ? styles.active : ''}`} onClick={() => setActiveMode('text')}>
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 7V4h16v3M9 20h6M12 4v16"/></svg>
                  Text
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
                    onClick={() => setActiveColor(c)}
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
                  />
                  <span className={styles.colorPickerGlyph}>+</span>
                </label>
              </div>
            </div>

            {/* Section 4: Size & Fill */}
            <div className={styles.section}>
              <div className={styles.sectionTitle}>Style</div>
              <div className={styles.styleRow}>
                <div className={styles.presetSizes}>
                  {SIZES.map((sizeValue) => (
                    <button
                      key={sizeValue}
                      className={`${styles.sizeBtn} ${styles.sizeSymbolBtn} ${activeSize === sizeValue ? styles.active : ''}`}
                      onClick={() => setActiveSize(sizeValue)}
                      title={`Set draw size ${sizeValue}`}
                    >
                      <div className={styles.sizeIndicator} style={{ width: sizeValue * 1.5, height: sizeValue * 1.5 }} />
                    </button>
                  ))}
                </div>
                <div className={styles.sizeInputWrap}>
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
                </div>
                <div className={styles.styleDivider} />
                <button
                  className={`${styles.sizeBtn} ${styles.fillBtn} ${activeFill ? styles.active : ''}`}
                  onClick={() => setActiveFill(!activeFill)}
                  title="Toggle Fill"
                >
                  <svg viewBox="0 0 24 24" width="16" height="16" fill={activeFill ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Section 5: Actions */}
            <div className={styles.actions}>
              <button className={`${styles.actionBtn} ${styles.danger}`} onClick={handleClear}>
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: '4px', verticalAlign: 'middle' }}><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6"/></svg>
                Clear
              </button>
              <button className={styles.actionBtn} onClick={handleImport}>
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: '4px', verticalAlign: 'middle' }}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
                Import
              </button>
              <button className={styles.actionBtn} onClick={handleExport}>
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: '4px', verticalAlign: 'middle' }}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/></svg>
                Export
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Render Text Annotations */}
      {textAnnotations.map(annotation => (
        <TextMarker 
          key={annotation.id} 
          mapRef={mapRef} 
          annotation={annotation} 
          onUpdate={(text) => updateTextAnnotation(annotation.id, text)}
          onRemove={() => removeTextAnnotation(annotation.id)}
          onDragEnd={(lngLat) => updateTextAnnotationPosition(annotation.id, lngLat)}
        />
      ))}
    </>
  );
}

function TextMarker({ 
  mapRef, 
  annotation, 
  onUpdate, 
  onRemove,
  onDragEnd,
}: { 
  mapRef: React.MutableRefObject<maplibregl.Map | null>; 
  annotation: TextAnnotation; 
  onUpdate: (text: string) => void;
  onRemove: () => void;
  onDragEnd: (lngLat: [number, number]) => void;
}) {
  const [markerContainer] = useState(() => {
    if (typeof document !== 'undefined') {
      const el = document.createElement('div');
      el.style.pointerEvents = 'auto'; // Ensure the container is interactive
      return el;
    }
    return null;
  });
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const onDragEndRef = useRef(onDragEnd);
  
  useEffect(() => { onDragEndRef.current = onDragEnd; }, [onDragEnd]);

  const [scale, setScale] = useState(1);

  useEffect(() => {
    if (!mapRef.current) return;
    const map = mapRef.current;

    const updateScale = () => {
      const currentZoom = map.getZoom();
      const zoomDiff = currentZoom - annotation.initialZoom;
      // Scale by 2^zoomDiff, constrained between 0.1 and 10
      const newScale = Math.max(0.1, Math.min(10, Math.pow(2, zoomDiff)));
      setScale(newScale);
    };

    map.on('zoom', updateScale);
    updateScale();

    return () => {
      map.off('zoom', updateScale);
    };
  }, [mapRef, annotation.initialZoom]);

  useEffect(() => {
    if (!mapRef.current || !markerContainer) return;

    if (!markerRef.current) {
      markerRef.current = new maplibregl.Marker({ element: markerContainer, draggable: true })
        .setLngLat(annotation.lngLat)
        .addTo(mapRef.current);

      markerRef.current.on('dragend', () => {
        const lngLat = markerRef.current!.getLngLat();
        onDragEndRef.current([lngLat.lng, lngLat.lat]);
      });
    } else {
      markerRef.current.setLngLat(annotation.lngLat);
    }
  }, [mapRef, annotation.lngLat, markerContainer]);

  useEffect(() => {
    return () => {
      if (markerRef.current) {
        markerRef.current.remove();
        markerRef.current = null;
      }
    };
  }, []);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!textareaRef.current) return;

    let raf2: number | null = null;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.focus();
        const cursorPosition = el.value.length;
        el.setSelectionRange(cursorPosition, cursorPosition);
      });
    });

    return () => {
      cancelAnimationFrame(raf1);
      if (raf2 !== null) {
        cancelAnimationFrame(raf2);
      }
    };
  }, [annotation.id]);

  useEffect(() => {
    if (!textareaRef.current) return;
    const el = textareaRef.current;
    const stop = (e: Event) => e.stopPropagation();
    
    // Use native event listeners to prevent MapLibre from intercepting the resize handle
    el.addEventListener('mousedown', stop);
    el.addEventListener('touchstart', stop);
    el.addEventListener('pointerdown', stop);
    
    return () => {
      el.removeEventListener('mousedown', stop);
      el.removeEventListener('touchstart', stop);
      el.removeEventListener('pointerdown', stop);
    };
  }, []);

  if (!markerContainer) return null;

  return createPortal(
    <div style={{ transform: `scale(${scale})`, transformOrigin: 'center center' }}>
      <div className={styles.textMarkerContainer}>
        <div className={styles.textMarkerDrag} title="Drag to move">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 9h14M5 15h14"/></svg>
        </div>
        <textarea
          ref={textareaRef}
        className={styles.textMarker}
        defaultValue={annotation.text}
        placeholder="Type here..."
        autoFocus
        rows={1}
        onChange={(e) => {
          onUpdate(e.target.value);
        }}
        onMouseDown={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          e.currentTarget.focus();
        }}
        onBlur={(e) => {
          if (e.target.value.trim() === '') {
            onRemove();
          }
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            e.currentTarget.blur();
          }
        }}
        onKeyUp={(e) => e.stopPropagation()}
      />
        <button className={styles.textMarkerDelete} onClick={(e) => { e.stopPropagation(); onRemove(); }}>
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      </div>
    </div>,
    markerContainer
  );
}