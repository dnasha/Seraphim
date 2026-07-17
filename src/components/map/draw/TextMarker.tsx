import React, { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import { createPortal } from 'react-dom';
import { TextAnnotation } from './drawPersistence';
import styles from '../MapDrawTools.module.css';

interface TextMarkerProps { 
  mapRef: React.MutableRefObject<maplibregl.Map | null>; 
  annotation: TextAnnotation; 
  activeMode: string;
  onUpdate: (text: string) => void;
  onRemove: () => void;
  onDragEnd: (lngLat: [number, number]) => void;
}

export function TextMarker({ 
  mapRef, 
  annotation, 
  activeMode,
  onUpdate, 
  onRemove,
  onDragEnd,
}: TextMarkerProps) {
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
      const instance = map;
      if (instance && typeof instance.off === 'function') {
        instance.off('zoom', updateScale);
      }
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
          title="Edit the text annotation"
          autoFocus
          rows={1}
          style={activeMode === 'eraser' ? { cursor: 'crosshair' } : undefined}
          onChange={(e) => {
            onUpdate(e.target.value);
          }}
          onMouseDown={(e) => {
            if (activeMode === 'eraser') {
              e.stopPropagation();
              onRemove();
            } else {
              e.stopPropagation();
            }
          }}
          onPointerDown={(e) => {
            if (activeMode === 'eraser') {
              e.stopPropagation();
              onRemove();
            } else {
              e.stopPropagation();
            }
          }}
          onClick={(e) => {
            e.stopPropagation();
            if (activeMode !== 'eraser') {
              e.currentTarget.focus();
            }
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
            <button className={styles.textMarkerDelete} onClick={(e) => { e.stopPropagation(); onRemove(); }} title="Delete this text annotation" aria-label="Delete this text annotation">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      </div>
    </div>,
    markerContainer
  );
}
