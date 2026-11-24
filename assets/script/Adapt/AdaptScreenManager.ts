import { _decorator, Canvas, Component, UITransform, find, view, screen, ResolutionPolicy, EventTarget } from "cc";
import { ScreenUtils } from "./ScreenUtils";

const { ccclass, menu, disallowMultiple, requireComponent } = _decorator;

/** 屏幕尺寸改变事件 */
export const ResizeEvent = "AdaptScreenManager_ResizeEvent";

@ccclass("AdaptScreenManager")
@disallowMultiple(true)
@menu("ScreenAdapt/AdaptScreenManager")
export class AdaptScreenManager extends Component {
    static eventTarget = new EventTarget();
    static _instance = null;
    private _designWidth;
    private _designHeight;

    static getInstance() {
        return AdaptScreenManager._instance;
    }

    onLoad() {
        AdaptScreenManager._instance = this;

        this._designWidth = ScreenUtils.DESIGN_WIDTH;
        this._designHeight = ScreenUtils.DESIGN_HEIGHT;

        const designSize = view.getDesignResolutionSize();
        this._designWidth = designSize.width;
        this._designHeight = designSize.height;

        screen.on("window-resize", this.onCanvasResize, this);
        this.onCanvasResize();
    }

    get designWidth() {
        return this._designWidth;
    }

    get designHeight() {
        return this._designHeight;
    }

    /** 竖屏模型 */
    get isPortrait() {
        return this.designHeight > this.designWidth;
    }

    /** 横屏模型 */
    get isLandscape() {
        return this.designWidth > this.designHeight;
    }

    onDestroy() {
        screen.off("window-resize", this.onCanvasResize, this);
        if (AdaptScreenManager._instance === this) {
            AdaptScreenManager._instance = null;
        }
    }

    swapDesignSize() {
        const temp = this.designWidth;
        this._designWidth = this.designHeight;
        this._designHeight = temp;
    }

    onCanvasResize() {
        const size = screen.windowSize;
        this.resetDesignResolutionSize(size.width, size.height);
    }

    resetDesignResolutionSize(width, height) {
        // 沙箱 iframe / 初始化早期 windowSize 可能是 0，会导致 NaN 分辨率 → 黑屏，直接跳过
        if (!width || !height || !Number.isFinite(width) || !Number.isFinite(height)) {
            return;
        }

        const isSizeCrossed =
            (width > height && this.designWidth < this.designHeight) ||
            (width < height && this.designWidth > this.designHeight);

        if (isSizeCrossed) {
            this.swapDesignSize();
        }

        const scale = (this.designWidth / width + this.designHeight / height) / 2;
        const designWidth = width * scale;
        const designHeight = height * scale;

        view.setDesignResolutionSize(designWidth, designHeight, ResolutionPolicy.SHOW_ALL);
        this.alignCanvasNode(designWidth, designHeight);
        AdaptScreenManager.eventTarget.emit(ResizeEvent, designWidth, designHeight);
    }

    /**
     * 设计分辨率变化后，把 Canvas 节点重新摆到可视区中心（引擎只在编辑器里做这一步，
     * 运行时只更新相机的 orthoHeight 和相机位置，不会挪 Canvas 节点）。
     *
     * 漏掉这一步的后果：相机一直以旧位置为中心渲染，而触摸点 getUILocation()
     * 是按“屏幕左下角 = (0,0)”用新设计分辨率换算的，两者原点对不上 ——
     * 表现就是手指按的格子与实际翻开的格子错位，越靠边偏得越多。
     *
     * 相机是 Canvas 的子节点，移动 Canvas 时相机会跟着走，所以画面观感不变，
     * 只有 UI 坐标系和相机的对应关系被修正了。
     */
    private alignCanvasNode(width: number, height: number) {
        const canvas = this.getComponent(Canvas) || find("Canvas")?.getComponent(Canvas);
        const node = canvas?.node;
        if (!node) return;

        // 用可视区尺寸对齐（SHOW_ALL 下可能与设计分辨率略有出入，相机是按可视区渲染的）
        const visible = view.getVisibleSize();
        const w = visible.width > 0 ? visible.width : width;
        const h = visible.height > 0 ? visible.height : height;

        const trans = node.getComponent(UITransform);
        const anchorX = trans ? trans.anchorX : 0.5;
        const anchorY = trans ? trans.anchorY : 0.5;
        node.setPosition(w * anchorX, h * anchorY, 0);
    }
}



