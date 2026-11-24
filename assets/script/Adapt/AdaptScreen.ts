import { _decorator, Component, Node, UITransform, Widget, view } from "cc";
import { EDITOR_NOT_IN_PREVIEW } from "cc/env";
import { AdaptScreenManager, ResizeEvent } from "./AdaptScreenManager";
import { ScreenUtils } from "./ScreenUtils";
import { AdaptTransformData, RecordMask } from "./AdaptTransformData";

const { ccclass, property, executeInEditMode, disallowMultiple, menu } =
  _decorator;

@ccclass("AdaptScreen")
@executeInEditMode(true)
@disallowMultiple(true)
@menu("ScreenAdapt/AdaptScreen")
export class AdaptScreen extends Component {
  @property({ type: [AdaptTransformData] })
  private _transformDatas: AdaptTransformData[] = [];

  private _transformData: AdaptTransformData | null = null;
  private resolutionChangedTime: number = 0;
  private widgetRecursiveDirty: Function | null = null;

  @property(AdaptTransformData)
  get transformDatas() {
    return this._transformDatas;
  }

  set transformDatas(value) {
    if (value !== this._transformDatas) {
      this._transformDatas = value;
      this._transformData =
        this._transformDatas.find(
          (d) => d.ratio === this._transformData?.ratio,
        ) ?? null;
    }
  }

  get transformData() {
    if (EDITOR_NOT_IN_PREVIEW) {
      const editorRatio = (view as any).editorCanvasSizeRatio;
      if (this._transformData == null && editorRatio) {
        this._transformData = new AdaptTransformData(editorRatio);
        this._transformData.adaptScreen = this;
        this.transformDatas.push(this._transformData);
      }
    }
    return this._transformData;
  }

  onLoad() {
    if (!this._transformDatas) {
      this._transformDatas = [];
    }
    this._transformData = null;
    this.resolutionChangedTime = 0;
    this.widgetRecursiveDirty = null;
    if (EDITOR_NOT_IN_PREVIEW) {
      this.node.on(
        Node.EventType.TRANSFORM_CHANGED,
        this.saveTransformData,
        this,
      );
      this.node.on(Node.EventType.SIZE_CHANGED, this.saveTransformSize, this);
      this.node.on(
        Node.EventType.ANCHOR_CHANGED,
        this.saveTransformAnchorPoint,
        this,
      );

      view.on("editor-canvas-resize", this.onEditorSizeChanged, this);
      this.onEditorSizeChanged((view as any).editorCanvasSizeRatio);

      const originalAddComponent = this.node.addComponent.bind(this.node);
      this.node.addComponent = (...args) => {
        const component = originalAddComponent(...args);
        this.node.emit("addComponent", component);
        return component;
      };
      this.node.on("addComponent", this.onAddComponent, this);

      const widget = this.getComponent(Widget);
      if (widget != null) {
        this.addWidgetEvent(widget);
      }
    } else {
      AdaptScreenManager.eventTarget.on(ResizeEvent, this.onResizeEvent, this);
      this.onResizeEvent();
    }
  }

  onDestroy() {
    if (EDITOR_NOT_IN_PREVIEW) {
      this.node.off(
        Node.EventType.TRANSFORM_CHANGED,
        this.saveTransformData,
        this,
      );
      this.node.off(Node.EventType.SIZE_CHANGED, this.saveTransformSize, this);
      this.node.off(
        Node.EventType.ANCHOR_CHANGED,
        this.saveTransformAnchorPoint,
        this,
      );
      view.off("editor-canvas-resize", this.onEditorSizeChanged, this);
      this.node.off("addComponent", this.onAddComponent, this);

      const widget = this.getComponent(Widget);
      if (widget && this.widgetRecursiveDirty) {
        (widget as any)._recursiveDirty = this.widgetRecursiveDirty;
      }
    } else {
      AdaptScreenManager.eventTarget.off(ResizeEvent, this.onResizeEvent, this);
    }
  }

  onAddComponent(component) {
    if (component instanceof Widget) {
      this.addWidgetEvent(component);
    }
  }

  addWidgetEvent(widget) {
    this.widgetRecursiveDirty = widget._recursiveDirty;
    widget._recursiveDirty = () => {
      this.widgetRecursiveDirty?.call(widget);
      this.saveWidget();
    };
  }

  onEditorSizeChanged(ratio) {
    this.resolutionChangedTime = Date.now();
    let data = (this._transformData =
      this.transformDatas.find((d) => d.ratio === ratio) ?? null);
    if (data == null) {
      const nearestData = ScreenUtils.getNearestRatioData(
        ratio,
        this.transformDatas,
      );
      if (nearestData != null) {
        this.updateTransformData(nearestData);
      }
    } else {
      this.updateTransformData(data);
    }
  }

  onResizeEvent() {
    const data = ScreenUtils.getNearestRatioData(
      ScreenUtils.getScreenRatio(),
      this.transformDatas,
    );
    if (data != null) {
      this.updateTransformData(data);
    }
  }

  onRecordMaskChanged(data, oldMask, newMask) {
    const changedMask = newMask & ~oldMask;
    if (changedMask & RecordMask.POSITION) {
      this.saveTransformData(Node.TransformBit.POSITION, data);
    }
    if (changedMask & RecordMask.ROTATION) {
      this.saveTransformData(Node.TransformBit.ROTATION, data);
    }
    if (changedMask & RecordMask.SCALE) {
      this.saveTransformData(Node.TransformBit.SCALE, data);
    }
    if (changedMask & RecordMask.SIZE) {
      this.saveTransformSize(null, data);
    }
    if (changedMask & RecordMask.ANCHOR) {
      this.saveTransformAnchorPoint(null, data);
    }
    if (changedMask & RecordMask.WIDGET) {
      this.saveWidget(data);
    }
  }

  saveTransformData(bit, data) {
    if (Date.now() - this.resolutionChangedTime < 100) return;

    const targetData = data ?? this.transformData;
    if (targetData == null) return;

    if (bit === undefined || bit & Node.TransformBit.SCALE) {
      targetData.scale = this.node.scale;
    }
    if (bit === undefined || bit & Node.TransformBit.ROTATION) {
      targetData.euler = this.node.eulerAngles;
    }

    const widget = this.getComponent(Widget);
    if (
      (bit === undefined || bit & Node.TransformBit.POSITION) &&
      widget == null
    ) {
      targetData.position = this.node.position;
    }
  }

  saveTransformSize(_event, data) {
    if (Date.now() - this.resolutionChangedTime < 100) return;

    const targetData = data ?? this.transformData;
    if (targetData == null) return;

    const uiTransform = this.getComponent(UITransform);
    if (uiTransform == null) return;

    const aspectRatio = this.getComponent("AspectRatio");
    if (aspectRatio != null) return;

    const widget = this.getComponent(Widget);
    if (widget) {
      if (
        widget.isStretchWidth &&
        targetData.size.height === uiTransform.height
      )
        return;
      if (widget.isStretchHeight && targetData.size.width === uiTransform.width)
        return;
    }

    targetData.size = uiTransform.contentSize;
  }

  saveTransformAnchorPoint(_event, data) {
    if (Date.now() - this.resolutionChangedTime < 100) return;

    const targetData = data ?? this.transformData;
    if (targetData == null) return;

    const uiTransform = this.getComponent(UITransform);
    if (uiTransform != null) {
      targetData.anchorPoint = uiTransform.anchorPoint;
    }
  }

  saveWidget(data?) {
    if (Date.now() - this.resolutionChangedTime < 100) return;

    const targetData = data ?? this.transformData;
    const widget = this.getComponent(Widget);
    if (widget != null && targetData != null) {
      targetData.setWidgetData(widget);
    }
  }

  updateTransformData(data) {
    const defaultData = ScreenUtils.getDefaultRatioData(
      data.ratio,
      this.transformDatas,
    );

    if (data.recordMask & RecordMask.POSITION) {
      this.node.setPosition(data.position);
    } else if (defaultData?.recordMask & RecordMask.POSITION) {
      this.node.setPosition(defaultData.position);
    }

    if (data.recordMask & RecordMask.ROTATION) {
      this.node.setRotationFromEuler(data.euler);
    } else if (defaultData?.recordMask & RecordMask.ROTATION) {
      this.node.setRotationFromEuler(defaultData.euler);
    }

    if (data.recordMask & RecordMask.SCALE) {
      this.node.setScale(data.scale);
    } else if (defaultData?.recordMask & RecordMask.SCALE) {
      this.node.setScale(defaultData.scale);
    }

    const uiTransform = this.getComponent(UITransform);
    if (uiTransform != null) {
      if (data.recordMask & RecordMask.SIZE) {
        uiTransform.setContentSize(data.size);
      } else if (defaultData?.recordMask & RecordMask.SIZE) {
        uiTransform.setContentSize(defaultData.size);
      }

      if (data.recordMask & RecordMask.ANCHOR) {
        uiTransform.setAnchorPoint(data.anchorPoint);
      } else if (defaultData?.recordMask & RecordMask.ANCHOR) {
        uiTransform.setAnchorPoint(defaultData.anchorPoint);
      }
    }

    const widget = this.getComponent(Widget);
    if (widget != null) {
      if (data.recordMask & RecordMask.WIDGET) {
        data.updateWidgetData(widget);
      } else if (defaultData?.recordMask & RecordMask.WIDGET) {
        defaultData.updateWidgetData(widget);
      }
    }
  }
}
