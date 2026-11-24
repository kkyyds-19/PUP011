import { _decorator, Vec3, Vec2, Size, BitMask, Enum } from "cc";
import { AdaptWidgetData } from "./AdaptWidgetData";
import { AdaptRatioType } from "./ScreenUtils";

const { ccclass, property } = _decorator;

/** 属性记录掩码 */
export enum RecordMask {
  NONE = 0,
  ALL = 0xffffffff,
  POSITION = 1 << 0,
  ROTATION = 1 << 1,
  SCALE = 1 << 2,
  SIZE = 1 << 3,
  ANCHOR = 1 << 4,
  WIDGET = 1 << 5,
}

@ccclass("AdaptTransformData")
export class AdaptTransformData {
  @property({
    type: Enum(AdaptRatioType),
    readonly: true,
    displayName: "MobileType",
  })
  ratio: AdaptRatioType = AdaptRatioType.IPad_Portrait;

  @property({ type: BitMask(RecordMask) })
  private _recordMask: number = RecordMask.NONE;

  @property()
  private _position: Vec3 = new Vec3();
  @property()
  private _euler: Vec3 = new Vec3();
  @property()
  private _scale: Vec3 = new Vec3();
  @property()
  private _size: Size = new Size();
  @property()
  private _anchorPoint: Vec2 = new Vec2();

  @property({ type: AdaptWidgetData })
  private _widgetData: AdaptWidgetData = new AdaptWidgetData();

  @property({ editorOnly: true })
  adaptScreen: any = null;
  @property({ type: BitMask(RecordMask) })
  get recordMask() {
    return this._recordMask;
  }
  set recordMask(value) {
    if (value !== this._recordMask) {
      this.adaptScreen?.onRecordMaskChanged(this, this._recordMask, value);
      this._recordMask = value;
    }
  }

  constructor(ratio = AdaptRatioType.IPad_Portrait) {
    this.ratio = AdaptRatioType.IPad_Portrait;
    this._recordMask = RecordMask.NONE;
    this._position = new Vec3();
    this._euler = new Vec3();
    this._scale = new Vec3();
    this._size = new Size();
    this._anchorPoint = new Vec2();
    this._widgetData = new AdaptWidgetData();
    this.adaptScreen = null;
    this.ratio = ratio;
  }

  get position() {
    return this._position;
  }

  set position(value) {
    this._position.set(value);
    this._recordMask |= RecordMask.POSITION;
  }

  get euler() {
    return this._euler;
  }

  set euler(value) {
    this._euler.set(value);
    this._recordMask |= RecordMask.ROTATION;
  }

  get scale() {
    return this._scale;
  }

  set scale(value) {
    this._scale.set(value);
    this._recordMask |= RecordMask.SCALE;
  }

  get size() {
    return this._size;
  }

  set size(value) {
    this._size.set(value);
    this._recordMask |= RecordMask.SIZE;
  }

  get anchorPoint() {
    return this._anchorPoint;
  }

  set anchorPoint(value) {
    this._anchorPoint.set(value);
    this._recordMask |= RecordMask.ANCHOR;
  }

  setWidgetData(widget) {
    this._widgetData.saveData(widget);
    this._recordMask |= RecordMask.WIDGET;
  }

  updateWidgetData(widget) {
    this._widgetData.updateData(widget);
  }
}
