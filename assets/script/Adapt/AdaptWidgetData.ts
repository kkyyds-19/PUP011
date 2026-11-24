import { _decorator, CCInteger, CCBoolean } from "cc";

const { ccclass, property } = _decorator;

@ccclass("AdaptWidgetData")
export class AdaptWidgetData {
  @property({ type: CCInteger })
  private _alignFlags: number = 0;
  @property({ type: CCInteger })
  private _top: number = 0;
  @property({ type: CCInteger })
  private _bottom: number = 0;
  @property({ type: CCInteger })
  private _left: number = 0;
  @property({ type: CCInteger })
  private _right: number = 0;
  @property({ type: CCInteger })
  private _horizontalCenter: number = 0;
  @property({ type: CCInteger })
  private _verticalCenter: number = 0;
  @property({ type: CCBoolean })
  private _isAbsTop: boolean = false;
  @property({ type: CCBoolean })
  private _isAbsBottom: boolean = false;
  @property({ type: CCBoolean })
  private _isAbsLeft: boolean = false;
  @property({ type: CCBoolean })
  private _isAbsRight: boolean = false;
  @property({ type: CCBoolean })
  private _isAbsHorizontalCenter: boolean = false;
  @property({ type: CCBoolean })
  private _isAbsVerticalCenter: boolean = false;

  constructor() {}

  saveData(widget) {
    for (const key of Object.keys(this)) {
      this[key] = widget[key];
    }
  }

  updateData(widget) {
    let changed = false;
    for (const key of Object.keys(this)) {
      if (widget[key] !== this[key]) {
        widget[key] = this[key];
        changed = true;
      }
    }
    if (changed) {
      widget.setDirty();
    }
  }

  set(data) {
    for (const key of Object.keys(data)) {
      this[key] = data[key];
    }
  }
}
