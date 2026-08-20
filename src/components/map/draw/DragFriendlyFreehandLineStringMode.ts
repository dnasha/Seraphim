import { TerraDrawFreehandLineStringMode } from 'terra-draw';

export type FreehandPointerEvent = Parameters<TerraDrawFreehandLineStringMode['onMouseMove']>[0];

export class DragFriendlyFreehandLineStringMode extends TerraDrawFreehandLineStringMode {
  private isDragSketchActive = false;

  // Sketch is intentionally press-drag-release only. A bare touch tap would
  // otherwise start Terra Draw's click-move-click workflow and leave a partial
  // feature waiting for a second tap.
  public onClick(): void {}

  public onDragStart(event?: FreehandPointerEvent, setMapDraggability?: (enabled: boolean) => void): void {
    if (!event) return;
    this.isDragSketchActive = true;
    setMapDraggability?.(false);
    super.onClick({ ...event, button: 'left', isContextMenu: false });
  }

  public onDrag(event?: FreehandPointerEvent): void {
    if (!event || !this.isDragSketchActive) return;
    super.onMouseMove(event);
  }

  public onDragEnd(event?: FreehandPointerEvent, setMapDraggability?: (enabled: boolean) => void): void {
    if (event && this.isDragSketchActive) {
      super.onMouseMove(event);
      super.onClick({ ...event, button: 'left', isContextMenu: false });
    }
    this.isDragSketchActive = false;
    setMapDraggability?.(true);
  }

  public cleanUp(): void {
    this.isDragSketchActive = false;
    super.cleanUp();
  }
}
