import { TerraDrawFreehandLineStringMode } from 'terra-draw';

export type FreehandPointerEvent = Parameters<TerraDrawFreehandLineStringMode['onMouseMove']>[0];

export class DragFriendlyFreehandLineStringMode extends TerraDrawFreehandLineStringMode {
  private isDragSketchActive = false;

  public onDragStart(event?: FreehandPointerEvent, setMapDraggability?: (enabled: boolean) => void): void {
    if (!event) return;
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
